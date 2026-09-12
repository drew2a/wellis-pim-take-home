// The one place that knows the order of an import run (ADR-0004, ADR-0009 item 6): raw load,
// mapping, canonical load, review items, all inside one transaction so a thrown error writes
// nothing. A dry run rolls that transaction back after the counts are known; its import_runs row
// is committed on its own so the run is on record.
import type { Rules } from '@/rules/schema';

import { loadConsentEvents } from './canonical/consent-events';
import { humanOwnedFields } from './canonical/human-owned';
import { loadIntakes } from './canonical/intakes';
import { loadPatients } from './canonical/patients';
import type { Queryable } from '@/db/queryable';
import { mapConsentEvent, type MappedConsentEvent } from './mapper/consent-event';
import { mapIntake, type MappedIntake } from './mapper/intake';
import { mapPatient, type MappedPatient } from './mapper/patient';
import type { RuleCode } from './mapper/rule-codes';
import {
  loadRawConsentEvents,
  loadRawIntakes,
  loadRawPatients,
  type ChangedRawRow,
  type RawTable,
  type RepeatedRawRow,
} from './raw/load';
import {
  dobFlipItems,
  orphanItems,
  shiftedPatientItems,
  shiftedPatients,
} from './review/cross-file';
import { insertReviewItems, type ReviewItemDraft } from './review/items';
import {
  changedSourceRowItems,
  confirmationItems,
  consentFlagItems,
  humanOwnedConflictItems,
  intakeFlagItems,
  patientFlagItems,
  repeatedKeyItems,
  unseenValueItems,
  type Ids,
} from './review/mapping-items';
import { finishRun, startRun } from './runs';
import { parseCsv } from './source/csv';
import { readExportFiles, type ExportFile } from './source/files';
import { parseConsentsJsonl } from './source/jsonl';
import { INTAKES_HEADER, PATIENTS_HEADER } from './source/layout';
import { IMPORTER_VERSION } from './version';

export interface ImportOptions {
  readonly exportDir: string;
  /** `YYYY-MM-DD`, validated by the caller (CLI) or the test. */
  readonly asOf: string;
  readonly dryRun: boolean;
  readonly rules: Rules;
}

export interface Counts {
  readonly inserted: number;
  readonly updated?: number;
}

export interface ImportSummary {
  readonly runId: number;
  readonly dryRun: boolean;
  readonly asOf: string;
  readonly importerVersion: string;
  readonly files: readonly Pick<ExportFile, 'name' | 'size' | 'sha256'>[];
  readonly raw: Readonly<
    Record<
      RawTable,
      {
        readonly inserted: number;
        readonly unchanged: number;
        readonly changed: number;
        /** Later occurrences of a repeated natural key; the raw table holds the first only. */
        readonly repeated: number;
      }
    >
  >;
  /** Rows per rule code over the whole export, the same on every run (the ADR-0005 table). */
  readonly rulesApplied: Readonly<Record<RuleCode, number>>;
  /** Rows per field and rule code, `field:CODE`. */
  readonly rulesByField: Readonly<Record<string, number>>;
  readonly recordsInserted: number;
  readonly canonical: {
    readonly patients: Counts;
    readonly intakes: Counts & { readonly orphans: number; readonly auditEntriesInserted: number };
    readonly consentEvents: Counts & { readonly skipped: number };
  };
  readonly consentTime: { readonly ambiguous: number; readonly nonexistent: number };
  /** Items the mapping raises for this export, `type/scope`, the same on every run. */
  readonly reviewItems: Readonly<Record<string, number>>;
  readonly reviewItemsInserted: number;
  readonly humanOwnedConflicts: number;
}

class DryRunRollback extends Error {
  constructor(readonly summary: ImportSummary) {
    super('dry run: rolling back');
  }
}

function tally<K extends string>(keys: readonly K[]): Record<K, number> {
  const out: Partial<Record<K, number>> = {};
  for (const key of keys) out[key] = (out[key] ?? 0) + 1;
  return out as Record<K, number>;
}

interface Mapped {
  readonly patients: readonly MappedPatient[];
  readonly intakes: readonly MappedIntake[];
  readonly consents: readonly MappedConsentEvent[];
}

function buildReviewItems(
  data: Mapped,
  ids: Ids,
  rules: Rules,
  orphans: readonly MappedIntake[],
  changedRows: readonly ChangedRawRow[],
  repeats: readonly RepeatedRawRow[],
  conflicts: Parameters<typeof humanOwnedConflictItems>[0],
): ReviewItemDraft[] {
  const shifted = shiftedPatients(data.patients);
  return [
    ...changedSourceRowItems(changedRows, ids),
    ...repeatedKeyItems(repeats, ids),
    ...data.patients.flatMap((p) => patientFlagItems(p, ids)),
    ...data.intakes.flatMap((i) => intakeFlagItems(i, ids, shifted.has(i.legacyPatientId))),
    ...data.consents.flatMap((c) => consentFlagItems(c, ids)),
    ...unseenValueItems(data.patients, data.intakes, data.consents),
    ...confirmationItems(data.patients, data.intakes),
    ...dobFlipItems(data, ids, rules),
    ...shiftedPatientItems(data, ids),
    ...orphanItems(orphans, data, ids),
    ...humanOwnedConflictItems(conflicts),
  ];
}

export async function runImport(db: Queryable, options: ImportOptions): Promise<ImportSummary> {
  const files = readExportFiles(options.exportDir);
  const patientRecords = parseCsv(files['patients.csv'].bytes, PATIENTS_HEADER);
  const intakeRecords = parseCsv(files['intakes.csv'].bytes, INTAKES_HEADER);
  const consentRecords = parseConsentsJsonl(files['consents.jsonl'].bytes);

  const runId = await startRun(db, { files, asOf: options.asOf, dryRun: options.dryRun });

  const summary = await db
    .transaction(async (tx) => {
      const rawPatients = await loadRawPatients(tx, runId, patientRecords);
      const rawIntakes = await loadRawIntakes(tx, runId, intakeRecords);
      const rawConsents = await loadRawConsentEvents(tx, runId, consentRecords);

      // Canonical rows are rewritten from the raw layer (ADR-0004), so the mapper reads the rows
      // the raw load returned, never the parsed file: a row whose source changed is mapped from
      // its stored version (the incoming version lives in a review item), and a natural key the
      // export repeats reaches the canonical layer once, because the raw table holds it once.
      const context = { asOf: options.asOf, rules: options.rules };
      const data: Mapped = {
        patients: rawPatients.stored.map((r) => mapPatient(r.fields, context)),
        intakes: rawIntakes.stored.map((r) => mapIntake(r.fields, context)),
        consents: rawConsents.stored.map((r) => mapConsentEvent(r.lineNo, r.fields)),
      };
      const allRecords = [
        ...data.patients.flatMap((p) => p.records),
        ...data.intakes.flatMap((i) => i.records),
        ...data.consents.flatMap((c) => c.records),
      ];

      const patients = await loadPatients(
        tx,
        runId,
        data.patients,
        await humanOwnedFields(tx, 'patient'),
      );
      const intakes = await loadIntakes(
        tx,
        runId,
        data.intakes,
        patients.ids,
        await humanOwnedFields(tx, 'intake'),
      );
      const consents = await loadConsentEvents(tx, runId, data.consents, patients.ids);

      const ids: Ids = { patients: patients.ids, intakes: intakes.ids };
      const conflicts = [...patients.conflicts, ...intakes.conflicts];
      const items = buildReviewItems(
        data,
        ids,
        options.rules,
        intakes.orphans,
        [...rawPatients.changed, ...rawIntakes.changed, ...rawConsents.changed],
        // consents.jsonl is keyed by line number, which the parser counts, so it cannot repeat
        // a key (ADR-0004); only the two CSV files can.
        [...rawPatients.repeats, ...rawIntakes.repeats],
        conflicts,
      );
      const reviewItemsInserted = await insertReviewItems(tx, runId, items);

      const rawCounts = (r: {
        inserted: number;
        unchanged: number;
        changed: readonly unknown[];
        repeats: readonly unknown[];
      }) => ({
        inserted: r.inserted,
        unchanged: r.unchanged,
        changed: r.changed.length,
        repeated: r.repeats.length,
      });
      const result: ImportSummary = {
        runId,
        dryRun: options.dryRun,
        asOf: options.asOf,
        importerVersion: IMPORTER_VERSION,
        files: Object.values(files).map(({ name, size, sha256 }) => ({ name, size, sha256 })),
        raw: {
          legacy_patients_raw: rawCounts(rawPatients),
          legacy_intakes_raw: rawCounts(rawIntakes),
          legacy_consent_events_raw: rawCounts(rawConsents),
        },
        rulesApplied: tally(allRecords.map((r) => r.ruleCode)),
        rulesByField: tally(allRecords.map((r) => `${r.field}:${r.ruleCode}`)),
        recordsInserted:
          patients.recordsInserted + intakes.recordsInserted + consents.recordsInserted,
        canonical: {
          patients: { inserted: patients.inserted, updated: patients.updated },
          intakes: {
            inserted: intakes.inserted,
            updated: intakes.updated,
            orphans: intakes.orphans.length,
            auditEntriesInserted: intakes.auditEntriesInserted,
          },
          consentEvents: { inserted: consents.inserted, skipped: consents.skipped },
        },
        consentTime: {
          ambiguous: allRecords.filter((r) => r.detail?.ambiguous === true).length,
          nonexistent: allRecords.filter((r) => r.detail?.nonexistent === true).length,
        },
        reviewItems: tally(items.map((i) => `${i.type}/${i.scope}`)),
        reviewItemsInserted,
        humanOwnedConflicts: conflicts.length,
      };
      if (options.dryRun) throw new DryRunRollback(result);
      return result;
    })
    .catch((error: unknown) => {
      if (error instanceof DryRunRollback) return error.summary;
      throw error;
    });

  await finishRun(db, runId);
  return summary;
}
