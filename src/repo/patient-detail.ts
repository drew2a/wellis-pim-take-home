// The patient's page (R-C9): the record, everything that belongs to it, and how it came to look
// the way it does.
//
// "Belongs to it" is the membership of ADR-0008 item 2 throughout — a patient's records are its own
// and those of every patient merged into it, transitively. Nothing here joins on the copied
// `patient_id` alone, because a merge moves no row (ADR-0011 item 3).
import { desc, eq, inArray } from 'drizzle-orm';

import type { Queryable } from '@/db/queryable';
import {
  auditEntries,
  consentEvents,
  consentStates,
  eligibilityEvaluations as eligibilityEvaluationsTable,
  intakes,
  legacyIntakesRaw,
  legacyPatientsRaw,
  normalisationRecords,
  patientLegacyIds,
  patients,
  reviewItems,
  type AuditChange,
} from '@/db/schema';

import { maskIdentifier } from './mask';
import { membersOf } from './membership';

export interface TimelineEntry {
  readonly kind: 'audit' | 'normalisation';
  readonly at: Date;
  /** Orders entries written in one transaction, which all carry the same `at` (ADR-0014 item 5). */
  readonly seq: number;
  readonly actor: string;
  readonly entity: string;
  readonly fromState: string | null;
  readonly toState: string | null;
  readonly reason: string;
  readonly changes: readonly AuditChange[] | null;
  /** The item this entry closed, when it closed one. */
  readonly reviewItem: { readonly id: string; readonly title: string } | null;
  /** The rule a normalisation record names, and the evidence it rests on. */
  readonly rule: string | null;
  readonly evidence: unknown;
}

export interface PatientIntake {
  readonly id: string;
  readonly intakeId: string | null;
  readonly state: string;
  readonly outcome: string;
  readonly submittedAt: string | null;
  /** Today's rules over a legacy intake: browsable, never applied (ADR-0005). */
  readonly shadow: { readonly outcome: string; readonly rulesetVersion: string } | null;
}

export interface PatientDetail {
  readonly patient: typeof patients.$inferSelect;
  /** Masked; the digits come from the reveal route, which records the look (ADR-0023 item 8). */
  readonly maskedBsn: string | null;
  /** Every patient whose records belong to this one, itself included. */
  readonly memberIds: readonly string[];
  readonly mergedAway: readonly { readonly id: string; readonly name: string }[];
  /** Where this record came from, and everything that has been merged into it since. */
  readonly legacyIds: readonly string[];
  readonly survivorOfMerge: string | null;
  readonly consent: readonly {
    readonly type: string;
    readonly state: string;
    readonly establishedByHand: boolean;
  }[];
  readonly consentEvents: readonly {
    readonly at: Date;
    readonly type: string;
    readonly action: string;
    readonly version: string | null;
  }[];
  readonly intakes: readonly PatientIntake[];
  readonly openItems: readonly {
    readonly id: string;
    readonly type: string;
    readonly title: string;
  }[];
  readonly timeline: readonly TimelineEntry[];
  readonly rawPatients: readonly (typeof legacyPatientsRaw.$inferSelect)[];
  readonly rawIntakes: readonly (typeof legacyIntakesRaw.$inferSelect)[];
}

/** Normalisation records carry no `seq`; they are ordered among the audit entries by time alone. */
const NO_SEQ = 0;

export async function patientDetail(db: Queryable, id: string): Promise<PatientDetail | null> {
  const [patient] = await db.select().from(patients).where(eq(patients.id, id));
  if (patient === undefined) return null;

  const memberIds = await membersOf(db, id);

  const mergedAway = await db
    .select({ id: patients.id, name: patients.fullName })
    .from(patients)
    .where(eq(patients.mergedInto, id));

  const aliases = await db
    .select({ legacyId: patientLegacyIds.legacyId })
    .from(patientLegacyIds)
    .where(inArray(patientLegacyIds.patientId, memberIds));

  const states = await db
    .select({
      type: consentStates.type,
      state: consentStates.state,
      derivationVersion: consentStates.derivationVersion,
    })
    .from(consentStates)
    .where(inArray(consentStates.patientId, memberIds));

  const events = await db
    .select({
      at: consentEvents.at,
      type: consentEvents.type,
      action: consentEvents.action,
      version: consentEvents.version,
    })
    .from(consentEvents)
    .where(inArray(consentEvents.patientId, memberIds))
    .orderBy(desc(consentEvents.at));

  const intakeRows = await db
    .select()
    .from(intakes)
    .where(inArray(intakes.patientId, memberIds))
    .orderBy(desc(intakes.submittedAt));

  const shadows =
    intakeRows.length === 0
      ? []
      : await db
          .select()
          .from(eligibilityEvaluationsTable)
          .where(
            inArray(
              eligibilityEvaluationsTable.intakeId,
              intakeRows.map((row) => row.id),
            ),
          );
  const shadowByIntake = new Map(
    shadows.filter((row) => row.shadow).map((row) => [row.intakeId, row]),
  );

  const items = await db
    .select({ id: reviewItems.id, type: reviewItems.type, title: reviewItems.title })
    .from(reviewItems)
    .where(inArray(reviewItems.patientId, memberIds));

  const entityIds = [...memberIds, ...intakeRows.map((row) => row.id)];
  const entries = await db
    .select()
    .from(auditEntries)
    .where(inArray(auditEntries.entityId, entityIds))
    .orderBy(desc(auditEntries.at), desc(auditEntries.seq));

  const itemIds = entries.flatMap((entry) =>
    entry.reviewItemId === null ? [] : [entry.reviewItemId],
  );
  const referenced =
    itemIds.length === 0
      ? []
      : await db
          .select({ id: reviewItems.id, title: reviewItems.title })
          .from(reviewItems)
          .where(inArray(reviewItems.id, itemIds));
  const itemById = new Map(referenced.map((row) => [row.id, row]));

  // The mapper writes normalisation records against the **exported** row, by its legacy id
  // (ADR-0009 item 3), so the timeline reaches them through the ids this membership resolves.
  const legacyIds = aliases.map((alias) => alias.legacyId);
  const exportedIntakeIds = intakeRows.flatMap((row) =>
    row.intakeId === null ? [] : [row.intakeId],
  );
  const records =
    legacyIds.length + exportedIntakeIds.length === 0
      ? []
      : await db
          .select()
          .from(normalisationRecords)
          .where(inArray(normalisationRecords.entityId, [...legacyIds, ...exportedIntakeIds]));

  const timeline: TimelineEntry[] = [
    ...entries.map((entry) => ({
      kind: 'audit' as const,
      at: entry.at,
      seq: entry.seq,
      actor: entry.actor,
      entity: `${entry.entityType} ${entry.entityId}`,
      fromState: entry.fromState,
      toState: entry.toState,
      reason: entry.reason,
      changes: entry.changes,
      reviewItem: entry.reviewItemId === null ? null : (itemById.get(entry.reviewItemId) ?? null),
      rule: null,
      evidence: null,
    })),
    ...records.map((record) => ({
      kind: 'normalisation' as const,
      at: record.createdAt,
      seq: NO_SEQ,
      actor: `importer ${record.importerVersion}`,
      entity: `${record.entityType} ${record.entityId}`,
      fromState: null,
      toState: null,
      reason: `${record.field}: ${record.fromValue} → ${record.toValue ?? 'null'}`,
      changes: [
        { field: record.field, from: record.fromValue, to: record.toValue },
      ] as AuditChange[],
      reviewItem: null,
      rule: record.ruleCode,
      evidence: record.evidence,
    })),
  ].sort((left, right) => right.at.getTime() - left.at.getTime() || right.seq - left.seq);

  const rawPatients =
    legacyIds.length === 0
      ? []
      : await db
          .select()
          .from(legacyPatientsRaw)
          .where(inArray(legacyPatientsRaw.legacyId, legacyIds));
  const rawIntakes =
    exportedIntakeIds.length === 0
      ? []
      : await db
          .select()
          .from(legacyIntakesRaw)
          .where(inArray(legacyIntakesRaw.intakeId, exportedIntakeIds));

  return {
    patient,
    maskedBsn: patient.bsn === null ? null : maskIdentifier(patient.bsn),
    memberIds,
    mergedAway,
    legacyIds,
    survivorOfMerge: patient.mergedInto,
    consent: states.map((row) => ({
      type: row.type,
      state: row.state,
      // ADR-0025: a state a person established over a log that contradicts itself.
      establishedByHand: row.derivationVersion === 'human',
    })),
    consentEvents: events,
    intakes: intakeRows.map((row) => {
      const shadow = shadowByIntake.get(row.id);
      return {
        id: row.id,
        intakeId: row.intakeId,
        state: row.state,
        outcome: row.outcome,
        submittedAt: row.submittedAt,
        shadow:
          shadow === undefined
            ? null
            : { outcome: shadow.engineOutcome, rulesetVersion: shadow.rulesetVersion },
      };
    }),
    openItems: items,
    timeline,
    rawPatients,
    rawIntakes,
  };
}
