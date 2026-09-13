// `POST /api/console/items/:id/resolve` — one route for every review-item action (ADR-0023).
//
// The body says **what the reviewer chose**, never what to write: which values a choice implies is
// decided on the server, from the item the importer raised (`@/console/decisions`, R-T4). The
// actor is the session's reviewer and is never read from the body (ADR-0021).
import { establishConsentState } from '@/consent/states';
import { CONSENT_TYPE_DATA_PROCESSING } from '@/consent/text';
import { consentRequestSchema, decideConsent } from '@/console/decisions/consent';
import { dataQualityRequestSchema, decideDataQuality } from '@/console/decisions/data-quality';
import {
  decideDuplicate,
  duplicateRequestSchema,
  pairedIntakeIds,
} from '@/console/decisions/duplicate';
import { decideIdentity, identityRequestSchema } from '@/console/decisions/identity';
import { decideOrphan, orphanRequestSchema } from '@/console/decisions/orphan';
import { DecisionError } from '@/console/decisions/types';
import {
  decideVocabulary,
  legacyIdsOf,
  vocabularyRequestSchema,
} from '@/console/decisions/vocabulary';
import { currentReviewer } from '@/console/reviewer';
import { getDb } from '@/db/client';
import { conflictView } from '@/repo/identity';
import {
  derivedConsentState,
  findReviewItem,
  intakesByExportedId,
  patientExists,
  patientsByLegacyId,
} from '@/repo/items';
import { mergePatients } from '@/repo/merge';
import { closeReviewItem, ResolutionError, resolveReviewItem } from '@/repo/resolve';
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
      case 'identity_conflict': {
        const parsed = identityRequestSchema.safeParse(raw);
        if (!parsed.success) return badRequest('that is not a decision', issuesOf(parsed.error));
        const identity = decideIdentity(await conflictView(db, view.item), parsed.data);
        if (identity.kind === 'dismiss') {
          decision = {
            outcome: 'dismissed',
            note: identity.note,
            changes: [],
            resolution: identity.resolution,
          };
          break;
        }
        // A merge is the one decision that does not go through the resolution path: its own two
        // audit entries carry the actor, the note and the field provenance, and both reference
        // this item (ADR-0022). Item and merge close together or not at all.
        const outcome = await db.transaction(async (tx) => {
          const merged = await mergePatients(tx, {
            survivorId: identity.survivorId,
            loserId: identity.loserId,
            actor: reviewer.name,
            actorReviewerId: reviewer.id,
            reason: identity.note,
            declaredConsentTypes: [CONSENT_TYPE_DATA_PROCESSING],
            reviewItemId: view.item.id,
            fieldDecisions: identity.fieldDecisions,
          });
          await closeReviewItem(tx, {
            itemId: view.item.id,
            reviewer,
            outcome: 'resolved',
            note: identity.note,
            resolution: { ...identity.resolution, applied: merged.merged },
          });
          return merged;
        });
        return json({
          status: 'resolved',
          merged: outcome.merged,
          changed: outcome.decided.length + outcome.gained.length,
        });
      }
      case 'orphan_intake': {
        const parsed = orphanRequestSchema.safeParse(raw);
        if (!parsed.success) return badRequest('that is not a decision', issuesOf(parsed.error));
        const exists =
          parsed.data.action === 'attach' && (await patientExists(db, parsed.data.patientId));
        decision = decideOrphan(view.item, parsed.data, exists);
        break;
      }
      case 'duplicate_intake': {
        const parsed = duplicateRequestSchema.safeParse(raw);
        if (!parsed.success) return badRequest('that is not a decision', issuesOf(parsed.error));
        const canonical = await intakesByExportedId(db, pairedIntakeIds(view.item));
        decision = decideDuplicate(view.item, parsed.data, canonical);
        break;
      }
      case 'data_quality': {
        const parsed = dataQualityRequestSchema.safeParse(raw);
        if (!parsed.success) return badRequest('that is not a decision', issuesOf(parsed.error));
        decision = decideDataQuality(view.item, parsed.data);
        break;
      }
      case 'consent': {
        const parsed = consentRequestSchema.safeParse(raw);
        if (!parsed.success) return badRequest('that is not a decision', issuesOf(parsed.error));
        const consent = decideConsent(
          view.item,
          parsed.data,
          await derivedConsentState(db, view.item),
        );
        if (consent.establish === null) {
          decision = consent.decision;
          break;
        }
        // The audit entry is the decision; the `consent_states` row is its cache, so they are
        // written together or not at all (ADR-0025 item 1).
        const { establish } = consent;
        await db.transaction(async (tx) => {
          await resolveReviewItem(tx, {
            itemId: view.item.id,
            reviewer,
            outcome: consent.decision.outcome,
            note: consent.decision.note,
            changes: consent.decision.changes,
            subjects: consent.decision.subjects,
            resolution: consent.decision.resolution,
          });
          await establishConsentState(tx, establish);
        });
        return json({ status: 'resolved', established: establish.state });
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
      subjects: decision.subjects,
      resolution: decision.resolution,
    });
    return json({ status: decision.outcome, changed: result.changes.length });
  } catch (error) {
    // Both mean the reviewer asked for something that cannot be written, which is a 400: the
    // decider refused the choice, or the resolution path refused the value.
    if (error instanceof DecisionError || error instanceof ResolutionError) {
      return badRequest(error.message);
    }
    return serverError(`resolving review item ${id.data} failed`, error);
  }
}
