// Canonical intakes (ADR-0004): upserted by intake_id, patient resolved through the alias table,
// null for orphans (ADR-0006). Each intake's legacy state gets one audit entry from actor
// `legacy import` with a deterministic dedupe_key, inserted ON CONFLICT DO NOTHING (ADR-0008).
import { eq, inArray } from 'drizzle-orm';

import { auditEntries, intakes } from '@/db/schema';

import { LEGACY_IMPORT_ACTOR } from '../actors';
import type { Queryable } from '@/db/queryable';
import type { CanonicalIntake, MappedIntake } from '../mapper/intake';
import { INTAKE_COLUMNS, diffAgainstStored } from './columns';
import type { HumanOwned, HumanOwnedConflict } from './human-owned';
import { insertNormalisationRecords } from './records';

export interface IntakeLoadResult {
  /** intake_id -> intakes.id for every mapped row. */
  readonly ids: ReadonlyMap<string, string>;
  /** Intakes whose legacy_patient_id resolves to no patient. */
  readonly orphans: readonly MappedIntake[];
  readonly inserted: number;
  readonly updated: number;
  readonly auditEntriesInserted: number;
  readonly recordsInserted: number;
  readonly conflicts: readonly HumanOwnedConflict[];
}

const CHUNK = 500;

export function legacyOutcomeReason(outcomeRaw: string): string {
  return 'legacy outcome `' + outcomeRaw + '`';
}

/** ADR-0008 item 1: deterministic from the five fields, so a re-run finds its own entry. */
export function auditDedupeKey(
  entityType: string,
  entityId: string,
  fromState: string | null,
  toState: string | null,
  reason: string,
): string {
  return [entityType, entityId, fromState ?? '', toState ?? '', reason].join('|');
}

export async function loadIntakes(
  db: Queryable,
  runId: number,
  mapped: readonly MappedIntake[],
  patientIds: ReadonlyMap<string, string>,
  humanOwned: HumanOwned,
): Promise<IntakeLoadResult> {
  const ids = new Map<string, string>();
  for (let i = 0; i < mapped.length; i += CHUNK) {
    const rows = await db
      .select({ id: intakes.id, intakeId: intakes.intakeId })
      .from(intakes)
      .where(
        inArray(
          intakes.intakeId,
          mapped.slice(i, i + CHUNK).map((m) => m.intakeId),
        ),
      );
    for (const r of rows) ids.set(r.intakeId, r.id);
  }
  const orphans = mapped.filter((i) => !patientIds.has(i.legacyPatientId));

  const fresh = mapped.filter((i) => !ids.has(i.intakeId));
  let inserted = 0;
  for (let i = 0; i < fresh.length; i += CHUNK) {
    const chunk = fresh.slice(i, i + CHUNK);
    const returned = await db
      .insert(intakes)
      .values(
        chunk.map((m) => ({
          ...m.canonical,
          intakeId: m.intakeId,
          legacyPatientId: m.legacyPatientId,
          patientId: patientIds.get(m.legacyPatientId) ?? null,
          createdByRun: runId,
        })),
      )
      .returning({ id: intakes.id, intakeId: intakes.intakeId });
    for (const r of returned) ids.set(r.intakeId, r.id);
    inserted += returned.length;
  }

  const freshIds = new Set(fresh.map((m) => m.intakeId));
  const existing = mapped.filter((i) => !freshIds.has(i.intakeId));
  const conflicts: HumanOwnedConflict[] = [];
  let updated = 0;
  for (let i = 0; i < existing.length; i += CHUNK) {
    const chunk = existing.slice(i, i + CHUNK);
    const stored = await db
      .select()
      .from(intakes)
      .where(
        inArray(
          intakes.id,
          chunk.map((m) => ids.get(m.intakeId) as string),
        ),
      );
    const byId = new Map(stored.map((s) => [s.id, s]));
    for (const m of chunk) {
      const id = ids.get(m.intakeId) as string;
      const row = byId.get(id);
      if (row === undefined) throw new Error(`intake ${m.intakeId} vanished during load`);
      const { changes, conflicts: own } = diffAgainstStored<CanonicalIntake>(
        m.canonical,
        row as CanonicalIntake,
        INTAKE_COLUMNS,
        humanOwned.get(id),
      );
      for (const c of own) {
        conflicts.push({ entityType: 'intake', entityId: id, naturalKey: m.intakeId, ...c });
      }
      // The patient link follows the alias table. An orphan a human attached keeps its link:
      // the alias table has no entry for it, so nothing here would overwrite the attachment.
      const patientId = patientIds.get(m.legacyPatientId) ?? null;
      const patch: Partial<CanonicalIntake> & { patientId?: string } = { ...changes };
      if (patientId !== null && row.patientId !== patientId) patch.patientId = patientId;
      if (Object.keys(patch).length > 0) {
        await db.update(intakes).set(patch).where(eq(intakes.id, id));
        updated += 1;
      }
    }
  }

  let auditEntriesInserted = 0;
  const entries = mapped.map((m) => {
    const id = ids.get(m.intakeId) as string;
    const reason = legacyOutcomeReason(m.canonical.outcomeRaw);
    return {
      actor: LEGACY_IMPORT_ACTOR,
      entityType: 'intake',
      entityId: id,
      fromState: null,
      toState: m.canonical.state,
      reason,
      dedupeKey: auditDedupeKey('intake', id, null, m.canonical.state, reason),
    };
  });
  for (let i = 0; i < entries.length; i += CHUNK) {
    const returned = await db
      .insert(auditEntries)
      .values(entries.slice(i, i + CHUNK))
      .onConflictDoNothing({ target: auditEntries.dedupeKey })
      .returning({ id: auditEntries.id });
    auditEntriesInserted += returned.length;
  }

  const recordsInserted = await insertNormalisationRecords(
    db,
    runId,
    mapped.map((m) => ({ entityType: 'legacy_intake', entityId: m.intakeId, records: m.records })),
  );
  return { ids, orphans, inserted, updated, auditEntriesInserted, recordsInserted, conflicts };
}
