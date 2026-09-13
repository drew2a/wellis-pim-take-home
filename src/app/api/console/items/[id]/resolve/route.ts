// `POST /api/console/items/:id/resolve` — one route for every review-item action (ADR-0023).
//
// The body says **what the reviewer chose**, never what to write: which values a choice implies is
// decided on the server, from the item the importer raised (`@/console/decisions`, R-T4). The
// actor is the session's reviewer and is never read from the body (ADR-0021).
import { currentReviewer } from '@/console/reviewer';
import { DecisionError } from '@/console/decisions/types';
import {
  decideVocabulary,
  legacyIdsOf,
  vocabularyRequestSchema,
} from '@/console/decisions/vocabulary';
import { getDb } from '@/db/client';
import { findReviewItem, patientsByLegacyId } from '@/repo/items';
import { resolveReviewItem } from '@/repo/resolve';
import type { Decision } from '@/console/decisions/types';

import {
  badRequest,
  conflict,
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

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const reviewer = await currentReviewer(request);
  if (reviewer === null) return unauthorized();

  const id = routeUuid.safeParse((await context.params).id);
  if (!id.success) return notFound('no such review item');

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return badRequest('the request body is not JSON');
  }

  try {
    const db = getDb();
    const view = await findReviewItem(db, id.data);
    if (view === null) return notFound('no such review item');
    if (view.item.status !== 'open') {
      return conflict(`this item is already ${view.item.status}; a decision is taken once`);
    }

    let decision: Decision;
    switch (view.item.type) {
      case 'vocabulary': {
        const parsed = vocabularyRequestSchema.safeParse(raw);
        if (!parsed.success) return badRequest('that is not a decision', issuesOf(parsed.error));
        const patientOf = await patientsByLegacyId(db, legacyIdsOf(view.item, view.rule));
        decision = decideVocabulary(view.item, view.rule, parsed.data, patientOf);
        break;
      }
      default:
        // Each type lands with its own screen and its own decider; until then the route says so
        // rather than accepting a decision it cannot carry out.
        return badRequest(`a ${view.item.type} item cannot be resolved from the console yet`);
    }

    const result = await resolveReviewItem(db, {
      itemId: view.item.id,
      reviewer,
      outcome: decision.outcome,
      note: decision.note,
      changes: decision.changes,
      resolution: decision.resolution,
    });
    return json({ status: decision.outcome, changed: result.changes.length });
  } catch (error) {
    if (error instanceof DecisionError) return badRequest(error.message);
    return serverError(`resolving review item ${id.data} failed`, error);
  }
}
