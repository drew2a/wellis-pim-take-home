// `POST /api/intakes/:id/submit` — the one request that turns a draft into a submitted intake
// (ADR-0015 item 5). Everything it does is in `submitIntake`, in one transaction; this handler only
// maps the outcome onto a status code.
//
// A submission that is incomplete or unconsented is a 400 that writes nothing: consent is an
// explicit grant naming the version of the text the patient was shown, and its absence fails the
// same Zod validation as a missing weight, with no special case for it (ADR-0015 item 4).
import { getDb } from '@/db/client';
import { submitIntake } from '@/intake/submit';

import { badRequest, conflict, intakeIdSchema, json, notFound, serverError } from '../../http';

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  const id = intakeIdSchema.safeParse((await context.params).id);
  if (!id.success) return notFound('no such intake');

  try {
    const outcome = await submitIntake(getDb(), { intakeId: id.data, now: new Date() });
    switch (outcome.kind) {
      case 'not_found':
        return notFound('no such intake');
      case 'not_draft':
        return conflict(`this intake has already been submitted (state ${outcome.state})`);
      case 'invalid':
        return badRequest('some answers need another look', outcome.issues);
      case 'submitted':
        return json({
          id: outcome.intakeId,
          state: outcome.state,
          outcome: outcome.result.outcome,
          // The explanation the patient is owed, in the engine's own words (R-B9).
          reasons: outcome.result.reasons,
          rulesetVersion: outcome.result.rulesetVersion,
        });
    }
  } catch (error) {
    return serverError(`submitting intake ${id.data} failed`, error);
  }
}
