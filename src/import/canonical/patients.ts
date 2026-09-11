// Canonical patients (ADR-0004): upserted by legacy id through patient_legacy_ids so the uuid
// never changes across runs (consent events reference it and cannot be updated). New rows are
// inserted with their alias; existing rows are rewritten from raw except human-owned fields.
import { eq, inArray } from 'drizzle-orm';

import { patientLegacyIds, patients } from '@/db/schema';

import type { Queryable } from '../db';
import type { CanonicalPatient, MappedPatient } from '../mapper/patient';
import { PATIENT_COLUMNS, diffAgainstStored } from './columns';
import type { HumanOwned, HumanOwnedConflict } from './human-owned';
import { insertNormalisationRecords } from './records';

export interface PatientLoadResult {
  /** legacy_id -> patients.id for every mapped row. */
  readonly ids: ReadonlyMap<string, string>;
  readonly inserted: number;
  readonly updated: number;
  readonly recordsInserted: number;
  readonly conflicts: readonly HumanOwnedConflict[];
}

const CHUNK = 500;

export async function loadPatients(
  db: Queryable,
  runId: number,
  mapped: readonly MappedPatient[],
  humanOwned: HumanOwned,
): Promise<PatientLoadResult> {
  const aliases = await db.select().from(patientLegacyIds);
  const ids = new Map(aliases.map((a) => [a.legacyId, a.patientId]));

  const fresh = mapped.filter((p) => !ids.has(p.legacyId));
  let inserted = 0;
  for (let i = 0; i < fresh.length; i += CHUNK) {
    const chunk = fresh.slice(i, i + CHUNK);
    const returned = await db
      .insert(patients)
      .values(chunk.map((p) => ({ ...p.canonical, createdByRun: runId })))
      .returning({ id: patients.id });
    if (returned.length !== chunk.length) {
      throw new Error(`patients insert returned ${returned.length} rows for ${chunk.length}`);
    }
    const aliasRows = chunk.map((p, j) => {
      const id = (returned[j] as { id: string }).id;
      ids.set(p.legacyId, id);
      return { legacyId: p.legacyId, patientId: id };
    });
    await db.insert(patientLegacyIds).values(aliasRows);
    inserted += chunk.length;
  }

  const freshIds = new Set(fresh.map((p) => p.legacyId));
  const existing = mapped.filter((p) => !freshIds.has(p.legacyId));
  const conflicts: HumanOwnedConflict[] = [];
  let updated = 0;
  for (let i = 0; i < existing.length; i += CHUNK) {
    const chunk = existing.slice(i, i + CHUNK);
    const stored = await db
      .select()
      .from(patients)
      .where(
        inArray(
          patients.id,
          chunk.map((p) => ids.get(p.legacyId) as string),
        ),
      );
    const byId = new Map(stored.map((s) => [s.id, s]));
    for (const p of chunk) {
      const id = ids.get(p.legacyId) as string;
      const row = byId.get(id);
      if (row === undefined) {
        throw new Error(`patient_legacy_ids points ${p.legacyId} at a missing patient ${id}`);
      }
      const { changes, conflicts: own } = diffAgainstStored<CanonicalPatient>(
        p.canonical,
        row,
        PATIENT_COLUMNS,
        humanOwned.get(id),
      );
      for (const c of own) {
        conflicts.push({ entityType: 'patient', entityId: id, naturalKey: p.legacyId, ...c });
      }
      if (Object.keys(changes).length > 0) {
        await db.update(patients).set(changes).where(eq(patients.id, id));
        updated += 1;
      }
    }
  }

  const recordsInserted = await insertNormalisationRecords(
    db,
    runId,
    mapped.map((p) => ({ entityType: 'legacy_patient', entityId: p.legacyId, records: p.records })),
  );
  return { ids, inserted, updated, recordsInserted, conflicts };
}
