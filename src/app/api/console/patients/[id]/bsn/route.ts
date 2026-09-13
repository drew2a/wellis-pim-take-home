// `POST /api/console/patients/:id/bsn` — reveals the number the console masks everywhere else.
//
// A route that **writes before it reads** (ADR-0023 item 8). It is unusual and it is deliberate:
// until the open vocabulary item on bsn retention is answered — keep, mask or drop — the
// defensible position is that the number is available to the care team and every look at it is on
// the record. A GET would be cached, prefetched and logged in a proxy; a POST is an act.
import { currentReviewer } from '@/console/reviewer';
import { getDb } from '@/db/client';
import { auditEntries, patients } from '@/db/schema';
import { eq } from 'drizzle-orm';

import { json, notFound, routeUuid, serverError, unauthorized } from '../../../../http';

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

const REASON = 'bsn revealed';

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const reviewer = await currentReviewer(request);
  if (reviewer === null) return unauthorized();

  const id = routeUuid.safeParse((await context.params).id);
  if (!id.success) return notFound('no such patient');

  try {
    const db = getDb();
    return await db.transaction(async (tx) => {
      const [patient] = await tx
        .select({ bsn: patients.bsn })
        .from(patients)
        .where(eq(patients.id, id.data));
      if (patient === undefined) return notFound('no such patient');

      // Written first, and in the same transaction: a number that reached a screen without an
      // entry saying who looked would be exactly the gap this route exists to close.
      await tx.insert(auditEntries).values({
        actor: reviewer.name,
        actorReviewerId: reviewer.id,
        entityType: 'patient',
        entityId: id.data,
        fromState: null,
        toState: null,
        reason: REASON,
        // Each look is its own event, like every other human entry (ADR-0008 item 1).
        dedupeKey: null,
      });
      return json({ bsn: patient.bsn });
    });
  } catch (error) {
    return serverError(`revealing the bsn of patient ${id.data} failed`, error);
  }
}
