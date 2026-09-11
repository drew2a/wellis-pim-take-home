// Raw layer load (ADR-0004, R-A8): every source row as exported, insert-only. The trigger of
// ADR-0007 forbids rewriting, so the load is `INSERT ... ON CONFLICT DO NOTHING`; a key that
// already exists with a different row_hash is reported to the caller with both versions and the
// stored row is left alone.
//
// Each loader also returns the rows as the raw table now holds them, one per natural key: that
// is what the canonical layer is built from (ADR-0004, "canonical rows are rewritten from raw"),
// so the file is read once, here, and a key the export repeats cannot reach the canonical layer
// twice.
import { inArray } from 'drizzle-orm';

import { legacyConsentEventsRaw, legacyIntakesRaw, legacyPatientsRaw } from '@/db/schema';

import type { Queryable } from '../db';
import type { CsvRecord } from '../source/csv';
import { sha256Hex } from '../source/hash';
import type { ConsentLine, JsonlRecord } from '../source/jsonl';
import { INTAKES_HEADER, PATIENTS_HEADER, byHeader } from '../source/layout';

export type RawTable = 'legacy_patients_raw' | 'legacy_intakes_raw' | 'legacy_consent_events_raw';

/** A source row whose key exists with different content: the export changed since that run. */
export interface ChangedRawRow {
  readonly table: RawTable;
  readonly key: string;
  /** The stored row's source columns under the export's own names. */
  readonly storedFields: Readonly<Record<string, string>>;
  /** The incoming row's source columns, so the review item can diff field by field. */
  readonly incomingFields: Readonly<Record<string, string>>;
  readonly stored: { readonly rowHash: string; readonly importRunId: number } & Record<
    string,
    unknown
  >;
  readonly incoming: { readonly rowHash: string; readonly lineNo: number } & Record<
    string,
    unknown
  >;
}

/** One row as the raw table holds it, which is what the mapper reads. */
export interface StoredRawRow<F> {
  readonly key: string;
  /** The line the stored row came from, which is not this file's line if the export moved it. */
  readonly lineNo: number;
  readonly fields: F;
}

export interface RawLoadResult<F> {
  /** Distinct natural keys this run inserted. */
  readonly inserted: number;
  /** Distinct keys already stored with the same row_hash. */
  readonly unchanged: number;
  /** Distinct keys already stored with a different row_hash. */
  readonly changed: readonly ChangedRawRow[];
  /** The stored rows for this export's keys, in file order, one per key. */
  readonly stored: readonly StoredRawRow<F>[];
  /**
   * Keys the export repeats. Only the first occurrence is in the raw table and in `stored`; the
   * rest are reported here rather than silently dropped or collided on downstream.
   */
  readonly duplicateKeys: readonly string[];
}

// Postgres accepts 65535 bind parameters per statement; 500 rows of 18 columns stays far below.
const CHUNK = 500;

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

/**
 * The first occurrence of each natural key, in file order, and the keys the export repeats.
 * Only the first occurrence reaches the raw table: the key is unique there, so a repeat would
 * be dropped by ON CONFLICT DO NOTHING anyway, unreported and invisible to the canonical layer.
 */
function firstPerKey<Row>(
  rows: readonly Row[],
  key: (row: Row) => string,
): { first: readonly Row[]; duplicateKeys: readonly string[] } {
  const first: Row[] = [];
  const seen = new Set<string>();
  const duplicateKeys: string[] = [];
  for (const row of rows) {
    const k = key(row);
    if (seen.has(k)) {
      duplicateKeys.push(k);
      continue;
    }
    seen.add(k);
    first.push(row);
  }
  return { first, duplicateKeys };
}

type PatientFields = Record<(typeof PATIENTS_HEADER)[number], string>;
type IntakeFields = Record<(typeof INTAKES_HEADER)[number], string>;

function patientFields(row: typeof legacyPatientsRaw.$inferSelect): PatientFields {
  return {
    legacy_id: row.legacyId,
    full_name: row.fullName,
    email: row.email,
    dob: row.dob,
    sex: row.sex,
    bsn: row.bsn,
    phone: row.phone,
    city: row.city,
    weight: row.weight,
    weight_unit: row.weightUnit,
    height_cm: row.heightCm,
    status: row.status,
    signup_date: row.signupDate,
    source: row.source,
  };
}

function intakeFields(row: typeof legacyIntakesRaw.$inferSelect): IntakeFields {
  return {
    intake_id: row.intakeId,
    legacy_patient_id: row.legacyPatientId,
    submitted_at: row.submittedAt,
    questionnaire_version: row.questionnaireVersion,
    weight: row.weight,
    height: row.height,
    meds_current: row.medsCurrent,
    conditions: row.conditions,
    alcohol_units_week: row.alcoholUnitsWeek,
    outcome: row.outcome,
    reviewer_note: row.reviewerNote,
  };
}

function consentFields(row: typeof legacyConsentEventsRaw.$inferSelect): ConsentLine {
  return {
    patient_legacy_id: row.patientLegacyId,
    type: row.type,
    action: row.action,
    at: row.at,
    version: row.version,
  };
}

export async function loadRawPatients(
  db: Queryable,
  runId: number,
  records: readonly CsvRecord[],
): Promise<RawLoadResult<PatientFields>> {
  const rows = records.map((record) => {
    const f = byHeader(PATIENTS_HEADER, record.fields);
    return {
      fields: f,
      row: {
        legacyId: f.legacy_id,
        fullName: f.full_name,
        email: f.email,
        dob: f.dob,
        sex: f.sex,
        bsn: f.bsn,
        phone: f.phone,
        city: f.city,
        weight: f.weight,
        weightUnit: f.weight_unit,
        heightCm: f.height_cm,
        status: f.status,
        signupDate: f.signup_date,
        source: f.source,
        lineNo: record.lineNo,
        sourceFile: 'patients.csv',
        rowHash: sha256Hex(record.raw),
        importRunId: runId,
      },
    };
  });
  const { first, duplicateKeys } = firstPerKey(rows, (r) => r.row.legacyId);
  const inserted = new Set<string>();
  for (const chunk of chunks(first)) {
    const returned = await db
      .insert(legacyPatientsRaw)
      .values(chunk.map((r) => r.row))
      .onConflictDoNothing({ target: legacyPatientsRaw.legacyId })
      .returning({ key: legacyPatientsRaw.legacyId });
    for (const r of returned) inserted.add(r.key);
  }
  // Read every key back, not only the ones that were already there: the canonical layer is
  // built from these rows (ADR-0004), so they must be what the table holds, not what the file
  // said. For a key the table already had, the stored row is the one that counts.
  const byKey = new Map<string, typeof legacyPatientsRaw.$inferSelect>();
  for (const chunk of chunks(first)) {
    const stored = await db
      .select()
      .from(legacyPatientsRaw)
      .where(
        inArray(
          legacyPatientsRaw.legacyId,
          chunk.map((r) => r.row.legacyId),
        ),
      );
    for (const s of stored) byKey.set(s.legacyId, s);
  }
  const changed: ChangedRawRow[] = [];
  const stored: StoredRawRow<PatientFields>[] = [];
  for (const { row: incoming, fields } of first) {
    const existing = byKey.get(incoming.legacyId);
    if (existing === undefined) {
      throw new Error(`legacy_patients_raw ${incoming.legacyId}: neither inserted nor found`);
    }
    if (!inserted.has(existing.legacyId) && existing.rowHash !== incoming.rowHash) {
      changed.push({
        table: 'legacy_patients_raw',
        key: existing.legacyId,
        storedFields: patientFields(existing),
        incomingFields: fields,
        stored: existing,
        incoming,
      });
    }
    stored.push({
      key: existing.legacyId,
      lineNo: existing.lineNo,
      fields: patientFields(existing),
    });
  }
  return {
    inserted: inserted.size,
    unchanged: first.length - inserted.size - changed.length,
    changed,
    stored,
    duplicateKeys,
  };
}

export async function loadRawIntakes(
  db: Queryable,
  runId: number,
  records: readonly CsvRecord[],
): Promise<RawLoadResult<IntakeFields>> {
  const rows = records.map((record) => {
    const f = byHeader(INTAKES_HEADER, record.fields);
    return {
      fields: f,
      row: {
        intakeId: f.intake_id,
        legacyPatientId: f.legacy_patient_id,
        submittedAt: f.submitted_at,
        questionnaireVersion: f.questionnaire_version,
        weight: f.weight,
        height: f.height,
        medsCurrent: f.meds_current,
        conditions: f.conditions,
        alcoholUnitsWeek: f.alcohol_units_week,
        outcome: f.outcome,
        reviewerNote: f.reviewer_note,
        lineNo: record.lineNo,
        sourceFile: 'intakes.csv',
        rowHash: sha256Hex(record.raw),
        importRunId: runId,
      },
    };
  });
  const { first, duplicateKeys } = firstPerKey(rows, (r) => r.row.intakeId);
  const inserted = new Set<string>();
  for (const chunk of chunks(first)) {
    const returned = await db
      .insert(legacyIntakesRaw)
      .values(chunk.map((r) => r.row))
      .onConflictDoNothing({ target: legacyIntakesRaw.intakeId })
      .returning({ key: legacyIntakesRaw.intakeId });
    for (const r of returned) inserted.add(r.key);
  }
  const byKey = new Map<string, typeof legacyIntakesRaw.$inferSelect>();
  for (const chunk of chunks(first)) {
    const stored = await db
      .select()
      .from(legacyIntakesRaw)
      .where(
        inArray(
          legacyIntakesRaw.intakeId,
          chunk.map((r) => r.row.intakeId),
        ),
      );
    for (const s of stored) byKey.set(s.intakeId, s);
  }
  const changed: ChangedRawRow[] = [];
  const stored: StoredRawRow<IntakeFields>[] = [];
  for (const { row: incoming, fields } of first) {
    const existing = byKey.get(incoming.intakeId);
    if (existing === undefined) {
      throw new Error(`legacy_intakes_raw ${incoming.intakeId}: neither inserted nor found`);
    }
    if (!inserted.has(existing.intakeId) && existing.rowHash !== incoming.rowHash) {
      changed.push({
        table: 'legacy_intakes_raw',
        key: existing.intakeId,
        storedFields: intakeFields(existing),
        incomingFields: fields,
        stored: existing,
        incoming,
      });
    }
    stored.push({
      key: existing.intakeId,
      lineNo: existing.lineNo,
      fields: intakeFields(existing),
    });
  }
  return {
    inserted: inserted.size,
    unchanged: first.length - inserted.size - changed.length,
    changed,
    stored,
    duplicateKeys,
  };
}

export async function loadRawConsentEvents(
  db: Queryable,
  runId: number,
  records: readonly JsonlRecord[],
): Promise<RawLoadResult<ConsentLine>> {
  const rows = records.map((record) => ({
    fields: record.fields,
    row: {
      patientLegacyId: record.fields.patient_legacy_id,
      type: record.fields.type,
      action: record.fields.action,
      at: record.fields.at,
      version: record.fields.version,
      lineNo: record.lineNo,
      sourceFile: 'consents.jsonl',
      rowHash: sha256Hex(record.raw),
      importRunId: runId,
    },
  }));
  // line_no is the key and the parser counts lines, so the export cannot repeat one (ADR-0004);
  // the split is here anyway so the three loaders answer the question the same way.
  const { first, duplicateKeys } = firstPerKey(rows, (r) => String(r.row.lineNo));
  const inserted = new Set<number>();
  for (const chunk of chunks(first)) {
    const returned = await db
      .insert(legacyConsentEventsRaw)
      .values(chunk.map((r) => r.row))
      .onConflictDoNothing({ target: legacyConsentEventsRaw.lineNo })
      .returning({ key: legacyConsentEventsRaw.lineNo });
    for (const r of returned) inserted.add(r.key);
  }
  const byKey = new Map<number, typeof legacyConsentEventsRaw.$inferSelect>();
  for (const chunk of chunks(first)) {
    const stored = await db
      .select()
      .from(legacyConsentEventsRaw)
      .where(
        inArray(
          legacyConsentEventsRaw.lineNo,
          chunk.map((r) => r.row.lineNo),
        ),
      );
    for (const s of stored) byKey.set(s.lineNo, s);
  }
  const changed: ChangedRawRow[] = [];
  const stored: StoredRawRow<ConsentLine>[] = [];
  for (const { row: incoming, fields } of first) {
    const existing = byKey.get(incoming.lineNo);
    if (existing === undefined) {
      throw new Error(
        `legacy_consent_events_raw line ${incoming.lineNo}: neither inserted nor found`,
      );
    }
    if (!inserted.has(existing.lineNo) && existing.rowHash !== incoming.rowHash) {
      changed.push({
        table: 'legacy_consent_events_raw',
        key: String(existing.lineNo),
        storedFields: consentFields(existing),
        incomingFields: fields,
        stored: existing,
        incoming,
      });
    }
    stored.push({
      key: String(existing.lineNo),
      lineNo: existing.lineNo,
      fields: consentFields(existing),
    });
  }
  return {
    inserted: inserted.size,
    unchanged: first.length - inserted.size - changed.length,
    changed,
    stored,
    duplicateKeys,
  };
}
