// One intake, with everything a reviewer needs to decide it (R-C7): what the patient submitted,
// what the rules made of it, whose record it belongs to, and who has it.
import { and, desc, eq } from 'drizzle-orm';

import type { Queryable } from '@/db/queryable';
import { auditEntries, intakes, patients } from '@/db/schema';
import type { IntakeState } from '@/intake/machine';

import { governingEvaluation, type Evaluation } from './evaluations';
import { survivorOf } from './membership';

export interface IntakeView {
  readonly intake: typeof intakes.$inferSelect;
  /** The surviving patient this intake belongs to (ADR-0008 item 2), or null for an orphan. */
  readonly patient: { readonly id: string; readonly name: string } | null;
  /** The evaluation the age carve-out reads and this screen shows — the same row (ADR-0014 item 3). */
  readonly evaluation: Evaluation | null;
  /**
   * Who has it, read from the claim's own audit entry. There is no `claimed_by` column by decision:
   * exclusive claiming falls out of the acyclic graph, and a column would be a second copy of a
   * fact the audit already holds (ADR-0014 item 1, ADR-0023 item 7).
   */
  readonly claim: { readonly reviewer: string; readonly at: Date } | null;
}

export async function findIntake(db: Queryable, id: string): Promise<IntakeView | null> {
  const [intake] = await db.select().from(intakes).where(eq(intakes.id, id));
  if (intake === undefined) return null;

  let patient: IntakeView['patient'] = null;
  if (intake.patientId !== null) {
    const survivorId = await survivorOf(db, intake.patientId);
    const [row] = await db
      .select({ id: patients.id, name: patients.fullName })
      .from(patients)
      .where(eq(patients.id, survivorId));
    patient = row ?? null;
  }

  return {
    intake,
    patient,
    evaluation: await governingEvaluation(db, id),
    claim: intake.state === 'in_review' ? await claimOf(db, id) : null,
  };
}

/** The latest entry that moved this intake into `in_review`: the reviewer who has it. */
async function claimOf(db: Queryable, intakeId: string): Promise<IntakeView['claim']> {
  const [entry] = await db
    .select({ actor: auditEntries.actor, at: auditEntries.at })
    .from(auditEntries)
    .where(
      and(
        eq(auditEntries.entityType, 'intake'),
        eq(auditEntries.entityId, intakeId),
        eq(auditEntries.toState, 'in_review'),
      ),
    )
    .orderBy(desc(auditEntries.seq))
    .limit(1);
  return entry === undefined ? null : { reviewer: entry.actor, at: entry.at };
}

/** The state an intake is in, without loading the rest of it. */
export async function intakeState(db: Queryable, id: string): Promise<IntakeState | null> {
  const [row] = await db.select({ state: intakes.state }).from(intakes).where(eq(intakes.id, id));
  return row?.state ?? null;
}
