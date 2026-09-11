// Raw layer load (ADR-0004, R-A8): every source row as exported, insert-only. The trigger of
// ADR-0007 forbids rewriting, so the load is `INSERT ... ON CONFLICT DO NOTHING`; a key that
// already exists with a different row_hash is reported to the caller with both versions and the
// stored row is left alone.
import { inArray } from 'drizzle-orm';

import { legacyConsentEventsRaw, legacyIntakesRaw, legacyPatientsRaw } from '@/db/schema';

import type { Queryable } from '../db';
import type { CsvRecord } from '../source/csv';
import { sha256Hex } from '../source/hash';
import type { JsonlRecord } from '../source/jsonl';
import { INTAKES_HEADER, PATIENTS_HEADER, byHeader } from '../source/layout';

export type RawTable = 'legacy_patients_raw' | 'legacy_intakes_raw' | 'legacy_consent_events_raw';

/** A source row whose key exists with different content: the export changed since that run. */
export interface ChangedRawRow {
  readonly table: RawTable;
  readonly key: string;
  /**
   * The stored row's source columns under the export's own names. Canonical rows are rewritten
   * from the raw layer (ADR-0004), so the mapper reads these, not the incoming file, for a row
   * whose source changed.
   */
  readonly storedFields: Readonly<Record<string, string>>;
  readonly stored: { readonly rowHash: string; readonly importRunId: number } & Record<
    string,
    unknown
  >;
  readonly incoming: { readonly rowHash: string; readonly lineNo: number } & Record<
    string,
    unknown
  >;
}

export interface RawLoadResult {
  readonly inserted: number;
  readonly unchanged: number;
  readonly changed: readonly ChangedRawRow[];
}

// Postgres accepts 65535 bind parameters per statement; 500 rows of 18 columns stays far below.
const CHUNK = 500;

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

export async function loadRawPatients(
  db: Queryable,
  runId: number,
  records: readonly CsvRecord[],
): Promise<RawLoadResult> {
  const rows = records.map((record) => {
    const f = byHeader(PATIENTS_HEADER, record.fields);
    return {
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
    };
  });
  const inserted = new Set<string>();
  for (const chunk of chunks(rows)) {
    const returned = await db
      .insert(legacyPatientsRaw)
      .values(chunk)
      .onConflictDoNothing({ target: legacyPatientsRaw.legacyId })
      .returning({ key: legacyPatientsRaw.legacyId });
    for (const r of returned) inserted.add(r.key);
  }
  const missing = rows.filter((r) => !inserted.has(r.legacyId));
  const changed: ChangedRawRow[] = [];
  for (const chunk of chunks(missing)) {
    const stored = await db
      .select()
      .from(legacyPatientsRaw)
      .where(
        inArray(
          legacyPatientsRaw.legacyId,
          chunk.map((r) => r.legacyId),
        ),
      );
    const byKey = new Map(stored.map((s) => [s.legacyId, s]));
    for (const incoming of chunk) {
      const existing = byKey.get(incoming.legacyId);
      if (existing === undefined) {
        throw new Error(`legacy_patients_raw ${incoming.legacyId}: neither inserted nor found`);
      }
      if (existing.rowHash !== incoming.rowHash) {
        changed.push({
          table: 'legacy_patients_raw',
          key: incoming.legacyId,
          storedFields: {
            legacy_id: existing.legacyId,
            full_name: existing.fullName,
            email: existing.email,
            dob: existing.dob,
            sex: existing.sex,
            bsn: existing.bsn,
            phone: existing.phone,
            city: existing.city,
            weight: existing.weight,
            weight_unit: existing.weightUnit,
            height_cm: existing.heightCm,
            status: existing.status,
            signup_date: existing.signupDate,
            source: existing.source,
          },
          stored: existing,
          incoming,
        });
      }
    }
  }
  return { inserted: inserted.size, unchanged: missing.length - changed.length, changed };
}

export async function loadRawIntakes(
  db: Queryable,
  runId: number,
  records: readonly CsvRecord[],
): Promise<RawLoadResult> {
  const rows = records.map((record) => {
    const f = byHeader(INTAKES_HEADER, record.fields);
    return {
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
    };
  });
  const inserted = new Set<string>();
  for (const chunk of chunks(rows)) {
    const returned = await db
      .insert(legacyIntakesRaw)
      .values(chunk)
      .onConflictDoNothing({ target: legacyIntakesRaw.intakeId })
      .returning({ key: legacyIntakesRaw.intakeId });
    for (const r of returned) inserted.add(r.key);
  }
  const missing = rows.filter((r) => !inserted.has(r.intakeId));
  const changed: ChangedRawRow[] = [];
  for (const chunk of chunks(missing)) {
    const stored = await db
      .select()
      .from(legacyIntakesRaw)
      .where(
        inArray(
          legacyIntakesRaw.intakeId,
          chunk.map((r) => r.intakeId),
        ),
      );
    const byKey = new Map(stored.map((s) => [s.intakeId, s]));
    for (const incoming of chunk) {
      const existing = byKey.get(incoming.intakeId);
      if (existing === undefined) {
        throw new Error(`legacy_intakes_raw ${incoming.intakeId}: neither inserted nor found`);
      }
      if (existing.rowHash !== incoming.rowHash) {
        changed.push({
          table: 'legacy_intakes_raw',
          key: incoming.intakeId,
          storedFields: {
            intake_id: existing.intakeId,
            legacy_patient_id: existing.legacyPatientId,
            submitted_at: existing.submittedAt,
            questionnaire_version: existing.questionnaireVersion,
            weight: existing.weight,
            height: existing.height,
            meds_current: existing.medsCurrent,
            conditions: existing.conditions,
            alcohol_units_week: existing.alcoholUnitsWeek,
            outcome: existing.outcome,
            reviewer_note: existing.reviewerNote,
          },
          stored: existing,
          incoming,
        });
      }
    }
  }
  return { inserted: inserted.size, unchanged: missing.length - changed.length, changed };
}

export async function loadRawConsentEvents(
  db: Queryable,
  runId: number,
  records: readonly JsonlRecord[],
): Promise<RawLoadResult> {
  const rows = records.map((record) => ({
    patientLegacyId: record.fields.patient_legacy_id,
    type: record.fields.type,
    action: record.fields.action,
    at: record.fields.at,
    version: record.fields.version,
    lineNo: record.lineNo,
    sourceFile: 'consents.jsonl',
    rowHash: sha256Hex(record.raw),
    importRunId: runId,
  }));
  const inserted = new Set<number>();
  for (const chunk of chunks(rows)) {
    const returned = await db
      .insert(legacyConsentEventsRaw)
      .values(chunk)
      .onConflictDoNothing({ target: legacyConsentEventsRaw.lineNo })
      .returning({ key: legacyConsentEventsRaw.lineNo });
    for (const r of returned) inserted.add(r.key);
  }
  const missing = rows.filter((r) => !inserted.has(r.lineNo));
  const changed: ChangedRawRow[] = [];
  for (const chunk of chunks(missing)) {
    const stored = await db
      .select()
      .from(legacyConsentEventsRaw)
      .where(
        inArray(
          legacyConsentEventsRaw.lineNo,
          chunk.map((r) => r.lineNo),
        ),
      );
    const byKey = new Map(stored.map((s) => [s.lineNo, s]));
    for (const incoming of chunk) {
      const existing = byKey.get(incoming.lineNo);
      if (existing === undefined) {
        throw new Error(
          `legacy_consent_events_raw line ${incoming.lineNo}: neither inserted nor found`,
        );
      }
      if (existing.rowHash !== incoming.rowHash) {
        changed.push({
          table: 'legacy_consent_events_raw',
          key: String(incoming.lineNo),
          storedFields: {
            patient_legacy_id: existing.patientLegacyId,
            type: existing.type,
            action: existing.action,
            at: existing.at,
            version: existing.version,
          },
          stored: existing,
          incoming,
        });
      }
    }
  }
  return { inserted: inserted.size, unchanged: missing.length - changed.length, changed };
}
