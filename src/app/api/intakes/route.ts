// `POST /api/intakes` — creates a draft from the first step's answers (ADR-0016 item 1, amending
// ADR-0015 item 3; edge 0 of ADR-0014).
//
// The draft begins with an answer, not with a page load: an `intakes` row that nobody has answered
// a question in claims an intake that never happened. Creating the row and saving step one are one
// transaction because they are one fact — this patient started an intake.
//
// The identity step is validated by the same schema `PATCH /api/intakes/:id` uses, so the two
// routes cannot disagree about what a valid first step is (`CLAUDE.md` §2).
//
// The intake's uuid is the only credential the patient gets: there is no patient authentication,
// which is a deliberate scope cut (README, R-S4).
import { auditEntries, intakes } from '@/db/schema';
import { getDb } from '@/db/client';
import { INTAKE_FORM_ACTOR } from '@/import/actors';
import { emptyAnswers, stepSchemas, type DraftAnswers } from '@/intake/answers';
import { todayIso } from '@/intake/today';
import { dedupeKeyFor } from '@/repo/audit';
import { currentRules } from '@/rules/load';

import { badRequest, issuesOf, json, serverError } from './http';

const CREATED_REASON = 'draft created by the intake form';

export async function POST(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return badRequest('the request body is not JSON');
  }

  const schema = stepSchemas({ rules: currentRules(), todayIso: todayIso() }).identity;
  const identity = schema.safeParse(raw);
  if (!identity.success) {
    return badRequest('some answers need another look', issuesOf(identity.error));
  }
  const answers: DraftAnswers = { ...emptyAnswers(), identity: identity.data };

  try {
    return await getDb().transaction(async (tx) => {
      const [created] = await tx
        .insert(intakes)
        .values({
          state: 'draft',
          answers,
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
      return json({ id: created.id, state: 'draft', answers }, 201);
    });
  } catch (error) {
    return serverError('creating a draft intake failed', error);
  }
}
