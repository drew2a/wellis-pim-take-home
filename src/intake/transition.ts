// The one function that moves an intake (ADR-0014 item 5). It is the only code that writes
// `intakes.state`, and the only code that writes an `audit_entries` row for an intake transition:
// there is no path that changes the state without recording who changed it and why (R-B18, R-B20).
//
// The machine itself is pure and lives in `./machine`; this module locks the row, fetches the one
// thing the machine cannot fetch (the governing evaluation), writes both rows in one transaction,
// and otherwise decides nothing.
import { and, eq } from 'drizzle-orm';

import type { Queryable } from '@/db/queryable';
import { auditEntries, intakes, type AuditChange } from '@/db/schema';
import type { MatchedRule } from '@/eligibility/types';
import { dedupeKeyFor } from '@/repo/audit';
import { governingEvaluation } from '@/repo/evaluations';
import { currentRules } from '@/rules/load';

import { checkTransition, edgeFor, type IntakeState, type TransitionActor } from './machine';

export interface TransitionRequest {
  /** The canonical uuid: `audit_entries` refers to canonical rows (ADR-0009 item 3). */
  readonly intakeId: string;
  readonly to: IntakeState;
  readonly actor: TransitionActor;
  /** A human's note, or the engine's explanation lines. Never empty (R-B20). */
  readonly reason: string;
  /** Required on the engine's edges, optional elsewhere (R-B8). */
  readonly rulesetVersion?: string | null;
  readonly reviewItemId?: string | null;
  readonly changes?: readonly AuditChange[] | null;
}

export interface TransitionResult {
  readonly from: IntakeState;
  readonly to: IntakeState;
  readonly auditEntryId: string;
  /** The order the entry was written in, which is how a submit's entries are rendered. */
  readonly seq: number;
}

/**
 * What the governing evaluation matched, or null when the intake has none at all. The evaluation
 * itself is chosen by `governingEvaluation`, which the console reads too: the reasons a reviewer
 * is shown and the rules this function refuses an approval over must be the same row.
 */
async function governingMatched(
  db: Queryable,
  intakeId: string,
): Promise<readonly MatchedRule[] | null> {
  return (await governingEvaluation(db, intakeId))?.matched ?? null;
}

/**
 * Moves the intake and records it, or throws `IllegalTransitionError` having written nothing. The
 * whole of it is one transaction: a state change without its audit entry is exactly the gap R-B18
 * forbids, and the database's own trigger checks the pair a second time on the way through.
 */
export async function transitionIntake(
  db: Queryable,
  request: TransitionRequest,
): Promise<TransitionResult> {
  const { intakeId, to, actor, reason } = request;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ state: intakes.state })
      .from(intakes)
      .where(eq(intakes.id, intakeId))
      .for('update');
    if (row === undefined) throw new Error(`no intake ${intakeId}`);
    const from = row.state;

    // Only one edge asks about the evaluation, so only that edge pays for the query.
    const edge = edgeFor(from, to);
    const matched =
      edge?.refusesAbsoluteReject === true ? await governingMatched(tx, intakeId) : undefined;

    checkTransition({
      from,
      to,
      actor,
      reason,
      rulesetVersion: request.rulesetVersion ?? null,
      matched,
      absoluteRejects: currentRules().precedence.absolute_rejects,
    });

    // `and(id, state)` rather than `id` alone: the row is locked, so this cannot fail, and if it
    // ever did the transition would have been computed against a state that is no longer there.
    const updated = await tx
      .update(intakes)
      .set({ state: to })
      .where(and(eq(intakes.id, intakeId), eq(intakes.state, from)))
      .returning({ id: intakes.id });
    if (updated.length !== 1) {
      throw new Error(`intake ${intakeId} changed state from ${from} while it was locked`);
    }

    const [entry] = await tx
      .insert(auditEntries)
      .values({
        actor: actor.name,
        // The stable identity behind a human actor; a named process has none (ADR-0014 item 4).
        actorReviewerId: actor.kind === 'reviewer' ? actor.id : null,
        entityType: 'intake',
        entityId: intakeId,
        fromState: from,
        toState: to,
        reason,
        rulesetVersion: request.rulesetVersion ?? null,
        reviewItemId: request.reviewItemId ?? null,
        changes:
          request.changes === undefined || request.changes === null ? null : [...request.changes],
        // Deterministic for a named process, null for a human: each human decision is a new event
        // (ADR-0008, ADR-0012 item 1). The machine is acyclic, so a process entry cannot collide.
        dedupeKey: dedupeKeyFor(actor.name, 'intake', intakeId, from, to, reason),
      })
      .returning({ id: auditEntries.id, seq: auditEntries.seq });
    if (entry === undefined)
      throw new Error(`the audit entry for intake ${intakeId} was not written`);

    return { from, to, auditEntryId: entry.id, seq: entry.seq };
  });
}
