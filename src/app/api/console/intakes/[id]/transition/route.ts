// `POST /api/console/intakes/:id/transition` — the routes that offer edges 5 to 10 of ADR-0014,
// which the state machine has had since Part B and nothing could reach until now.
//
// It decides nothing. `transitionIntake` is the only writer of `intakes.state` and the only judge
// of whether a move is allowed; this handler turns a session into an actor, a refusal into a status
// code, and nothing else. The role comes from the session and never from the body (ADR-0021), which
// is what makes the doctor gate mean something.
import { z } from 'zod';

import { currentReviewer } from '@/console/reviewer';
import { getDb } from '@/db/client';
import { edgeFor, IllegalTransitionError, type IntakeState } from '@/intake/machine';
import { transitionIntake } from '@/intake/transition';
import { intakeState } from '@/repo/intakes';

import {
  badRequest,
  conflict,
  forbidden,
  issuesOf,
  json,
  notFound,
  routeUuid,
  serverError,
  unauthorized,
} from '../../../../http';

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

/**
 * The three moves a reviewer may ask for. `to` rather than a verb, because the machine's vocabulary
 * is the state it moves to and a second set of names would be a synonym (`CLAUDE.md` §6).
 *
 * A claim's reason is written for them: `in_review` means a named person has it, and asking for a
 * sentence to say so would be ceremony. Approving and rejecting are medical decisions and carry
 * the reviewer's own words (R-C8).
 */
const transitionSchema = z.discriminatedUnion('to', [
  z.object({ to: z.literal('in_review') }).strict(),
  z
    .object({
      to: z.enum(['approved', 'rejected']),
      note: z.string().trim().min(1, 'a decision records why'),
    })
    .strict(),
]);

const CLAIM_REASON = 'claimed for review';

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const reviewer = await currentReviewer(request);
  if (reviewer === null) return unauthorized();

  const id = routeUuid.safeParse((await context.params).id);
  if (!id.success) return notFound('no such intake');

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return badRequest('the request body is not JSON');
  }
  const parsed = transitionSchema.safeParse(raw);
  if (!parsed.success) return badRequest('that is not a move', issuesOf(parsed.error));

  const db = getDb();
  // Read before the try and kept in scope, because the catch needs it: telling a state race apart
  // from a refusal is the question "is the intake still where it was when we looked".
  let from: IntakeState | null = null;
  try {
    from = await intakeState(db, id.data);
    if (from === null) return notFound('no such intake');

    const to: IntakeState = parsed.data.to;
    // A pair that is not an edge is a conflict — the intake is not where the caller thinks it is —
    // while a pair that is an edge they may not take is a refusal about them. Both quote the
    // machine; only the status code is chosen here.
    const edge = edgeFor(from, to);
    if (edge === undefined) {
      return conflict(`this intake is ${from}, and ${from} → ${to} is not a move it can make`);
    }

    const result = await transitionIntake(db, {
      intakeId: id.data,
      to,
      actor: { kind: 'reviewer', id: reviewer.id, name: reviewer.name },
      reason: parsed.data.to === 'in_review' ? CLAIM_REASON : parsed.data.note,
    });
    return json({ from: result.from, to: result.to });
  } catch (error) {
    if (error instanceof IllegalTransitionError) {
      // The role gate and the age carve-out are "not for you" (ADR-0014 item 3), and the message
      // is the machine's own so the reviewer is told which rule refused. But the same error is
      // raised when the intake moved between the read above and the transaction — somebody else
      // claimed it — and that is a conflict about the intake, not a refusal about the reviewer.
      const now = await intakeState(db, id.data);
      if (now !== from) {
        return conflict(`this intake is ${now ?? 'gone'} now, not ${from}; reload it`);
      }
      return forbidden(error.message);
    }
    return serverError(`moving intake ${id.data} failed`, error);
  }
}
