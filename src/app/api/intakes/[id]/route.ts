// `GET /api/intakes/:id` — the intake as the patient sees it — and
// `PATCH /api/intakes/:id` — saving one step of the form (ADR-0015 item 3). The first step is not
// saved here: it arrives with `POST /api/intakes`, which creates the draft from it (ADR-0016).
//
// Saving a step is not a transition: the state stays `draft` and no audit entry is written, because
// R-B18 audits state changes and an entry per keystroke would bury the ones that matter
// (ADR-0014 item 1). What the patient finally submitted is kept verbatim in `answers`.
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { getDb } from '@/db/client';
import { eligibilityEvaluations, intakes } from '@/db/schema';
import { INTAKE_STEPS, stepSchemas, type DraftAnswers, type IntakeStep } from '@/intake/answers';
import { todayIso } from '@/intake/today';
import { currentRules } from '@/rules/load';

import { badRequest, conflict, issuesOf, json, notFound, routeUuid, serverError } from '../../http';

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

const bodySchema = z.object({ step: z.enum(INTAKE_STEPS), answers: z.unknown() });

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const id = routeUuid.safeParse((await context.params).id);
  if (!id.success) return notFound('no such intake');
  try {
    const db = getDb();
    const [intake] = await db
      .select({
        id: intakes.id,
        state: intakes.state,
        answers: intakes.answers,
        rulesetVersion: intakes.rulesetVersion,
        outcome: intakes.outcome,
      })
      .from(intakes)
      .where(eq(intakes.id, id.data));
    if (intake === undefined) return notFound('no such intake');

    // Once submitted, the patient is shown what the rules found and why (R-B9). A draft has none.
    //
    // The governing evaluation, ordered exactly as `governingMatched` in `src/intake/transition.ts`
    // orders it: latest first, non-shadow ahead of shadow on a tie. An intake can hold more than
    // one row — every import run rewrites the shadow evaluations — and showing the patient
    // whichever one Postgres returned first could show them a shadow verdict as their outcome.
    const [evaluation] = await db
      .select({
        engineOutcome: eligibilityEvaluations.engineOutcome,
        reasons: eligibilityEvaluations.reasons,
      })
      .from(eligibilityEvaluations)
      .where(eq(eligibilityEvaluations.intakeId, intake.id))
      .orderBy(desc(eligibilityEvaluations.evaluatedAt), eligibilityEvaluations.shadow)
      .limit(1);

    return json({
      id: intake.id,
      state: intake.state,
      answers: intake.answers,
      outcome: intake.outcome,
      rulesetVersion: intake.rulesetVersion,
      evaluation: evaluation ?? null,
    });
  } catch (error) {
    return serverError(`reading intake ${id.data} failed`, error);
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const id = routeUuid.safeParse((await context.params).id);
  if (!id.success) return notFound('no such intake');

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return badRequest('the request body is not JSON');
  }
  const body = bodySchema.safeParse(raw);
  if (!body.success) return badRequest('the request body is not a form step', issuesOf(body.error));

  const schema = stepSchemas({ rules: currentRules(), todayIso: todayIso() })[body.data.step];
  const step = schema.safeParse(body.data.answers);
  if (!step.success) return badRequest('some answers need another look', issuesOf(step.error));

  try {
    return await getDb().transaction(async (tx) => {
      const [intake] = await tx
        .select({ state: intakes.state, answers: intakes.answers })
        .from(intakes)
        .where(eq(intakes.id, id.data))
        .for('update');
      if (intake === undefined) return notFound('no such intake');
      if (intake.state !== 'draft') {
        // The database refuses this too (ADR-0014 item 6); saying so in words is kinder than a 500.
        return conflict(`this intake has already been submitted (state ${intake.state})`);
      }

      // Every draft is created by `POST /api/intakes`, which writes `formVersion` with the first
      // step, and a legacy intake is never in `draft`. A draft without answers is therefore a
      // broken invariant, not a case to paper over: inventing a `formVersion` here would produce a
      // submission the schema rejects with an issue naming a field the form does not render
      // (`CLAUDE.md` §2 — no default values, no swallowed errors).
      if (intake.answers === null) {
        throw new Error(`draft intake ${id.data} has no answers`);
      }
      const merged: DraftAnswers = {
        ...intake.answers,
        [body.data.step satisfies IntakeStep]: step.data,
      };
      await tx.update(intakes).set({ answers: merged }).where(eq(intakes.id, id.data));
      return json({ id: id.data, state: 'draft', answers: merged });
    });
  } catch (error) {
    return serverError(`saving a step of intake ${id.data} failed`, error);
  }
}
