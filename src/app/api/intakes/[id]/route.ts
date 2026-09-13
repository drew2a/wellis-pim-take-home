// `GET /api/intakes/:id` — the intake as the patient sees it — and
// `PATCH /api/intakes/:id` — saving one step of the form (ADR-0015 item 3).
//
// Saving a step is not a transition: the state stays `draft` and no audit entry is written, because
// R-B18 audits state changes and an entry per keystroke would bury the ones that matter
// (ADR-0014 item 1). What the patient finally submitted is kept verbatim in `answers`.
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { getDb } from '@/db/client';
import { eligibilityEvaluations, intakes } from '@/db/schema';
import { INTAKE_STEPS, stepSchemas, type DraftAnswers, type IntakeStep } from '@/intake/answers';
import { currentRules } from '@/rules/load';

import { badRequest, conflict, intakeIdSchema, issuesOf, notFound, serverError } from '../http';

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

const bodySchema = z.object({ step: z.enum(INTAKE_STEPS), answers: z.unknown() });

const todayIso = (): string => new Date().toISOString().slice(0, 10);

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const id = intakeIdSchema.safeParse((await context.params).id);
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
    const [evaluation] = await db
      .select({
        engineOutcome: eligibilityEvaluations.engineOutcome,
        reasons: eligibilityEvaluations.reasons,
      })
      .from(eligibilityEvaluations)
      .where(eq(eligibilityEvaluations.intakeId, intake.id));

    return Response.json({
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
  const id = intakeIdSchema.safeParse((await context.params).id);
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

      const merged: DraftAnswers = {
        ...(intake.answers ?? {}),
        formVersion: intake.answers?.formVersion ?? '',
        [body.data.step satisfies IntakeStep]: step.data,
      };
      await tx.update(intakes).set({ answers: merged }).where(eq(intakes.id, id.data));
      return Response.json({ id: id.data, state: 'draft', answers: merged });
    });
  } catch (error) {
    return serverError(`saving a step of intake ${id.data} failed`, error);
  }
}
