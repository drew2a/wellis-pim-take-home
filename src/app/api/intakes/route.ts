// `POST /api/intakes` — creates a draft (ADR-0015 item 3, edge 0 of ADR-0014).
//
// The intake's uuid is the only credential the patient gets: there is no patient authentication,
// which is a deliberate scope cut (README, R-S4).
import { auditEntries, intakes } from '@/db/schema';
import { getDb } from '@/db/client';
import { INTAKE_FORM_ACTOR } from '@/import/actors';
import { emptyAnswers } from '@/intake/answers';
import { dedupeKeyFor } from '@/repo/audit';

import { serverError } from './http';

const CREATED_REASON = 'draft created by the intake form';

export async function POST(): Promise<Response> {
  try {
    return await getDb().transaction(async (tx) => {
      const [created] = await tx
        .insert(intakes)
        .values({
          state: 'draft',
          answers: emptyAnswers(),
          // Nothing is reported until the patient has answered the steps that ask (`CLAUDE.md` §6).
          medicationReport: 'not_answered',
          conditionReport: 'not_answered',
          // The medical result, open until a human decides it. Never the state.
          outcome: 'pending',
        })
        .returning({ id: intakes.id });
      if (created === undefined) throw new Error('the draft intake was not created');

      // Creation is not a transition — there is no state to come from — so it does not go through
      // `transitionIntake`, but it is still a thing that happened to an intake (R-B18).
      await tx.insert(auditEntries).values({
        actor: INTAKE_FORM_ACTOR,
        entityType: 'intake',
        entityId: created.id,
        fromState: null,
        toState: 'draft',
        reason: CREATED_REASON,
        dedupeKey: dedupeKeyFor(
          INTAKE_FORM_ACTOR,
          'intake',
          created.id,
          null,
          'draft',
          CREATED_REASON,
        ),
      });
      return Response.json({ id: created.id, state: 'draft' }, { status: 201 });
    });
  } catch (error) {
    return serverError('creating a draft intake failed', error);
  }
}
