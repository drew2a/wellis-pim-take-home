// Resolving an `identity_conflict`: two records that share a key, and a person deciding whether
// they are one patient (R-C4, R-C5, R-C6). Forty-four open, every one of them tier 2 or 3 — the
// tier-1 pairs, where the rows are identical, the importer already merged (ADR-0006).
//
// Three answers, and only one of them writes: **merge**, with a survivor and a value per field;
// **not the same person**, which dismisses; and leaving it open, which is not a request at all.
// Merging a pair automatically on a heuristic is what ADR-0006 rejected, so nothing here proposes
// a survivor — the reviewer picks one.
import { z } from 'zod';

import { DECIDABLE_FIELDS, type ConflictView } from '@/repo/identity';
import type { FieldDecision, FieldDecisions, PersonField } from '@/repo/merge';

import { DecisionError } from './types';

/** The column names the screen speaks, to the drizzle properties `mergePatients` takes. */
const PROPERTY_OF: Readonly<Record<string, PersonField>> = {
  full_name: 'fullName',
  email: 'email',
  dob: 'dob',
  sex: 'sex',
  bsn: 'bsn',
  phone: 'phone',
  city: 'city',
  weight_kg: 'weightKg',
  height_cm: 'heightCm',
  status: 'status',
};

/**
 * Picking a row carries no value: the merge has both rows and reads it from the one that was named
 * (ADR-0022 item 1). That is what keeps a masked `bsn` out of the column — the screen displays
 * `******333` and could not write it back if it tried. Only an edit carries text.
 */
const fieldDecision = z.discriminatedUnion('source', [
  z.object({ source: z.literal('survivor') }).strict(),
  z.object({ source: z.literal('loser') }).strict(),
  z.object({ source: z.literal('edited'), value: z.string().nullable() }).strict(),
]);

export const identityRequestSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('merge'),
      note: z.string().trim().min(1, 'say why, in a sentence'),
      survivorId: z.uuid(),
      loserId: z.uuid(),
      /** Only the fields the reviewer actually decided; the rest keep ADR-0006's rule. */
      decisions: z.partialRecord(z.enum(DECIDABLE_FIELDS), fieldDecision).default({}),
    })
    .strict(),
  z
    .object({
      action: z.literal('not_the_same_person'),
      note: z.string().trim().min(1, 'say why, in a sentence'),
    })
    .strict(),
]);

export type IdentityRequest = z.infer<typeof identityRequestSchema>;

export interface IdentityMerge {
  readonly kind: 'merge';
  readonly survivorId: string;
  readonly loserId: string;
  readonly fieldDecisions: FieldDecisions;
  readonly note: string;
  readonly resolution: Readonly<Record<string, unknown>>;
}

export interface IdentityDismissal {
  readonly kind: 'dismiss';
  readonly note: string;
  readonly resolution: Readonly<Record<string, unknown>>;
}

export type IdentityDecision = IdentityMerge | IdentityDismissal;

/**
 * What the reviewer's answer means, against the records the item is actually about. The survivor
 * and the loser must both be candidates of this item: a uuid from a request must never be able to
 * merge two patients that were never compared.
 */
export function decideIdentity(view: ConflictView, request: IdentityRequest): IdentityDecision {
  if (request.action === 'not_the_same_person') {
    return {
      kind: 'dismiss',
      note: request.note,
      resolution: {
        action: 'not_the_same_person',
        candidates: view.candidates.map((c) => c.patientId),
      },
    };
  }

  const ids = new Set(view.candidates.map((candidate) => candidate.patientId));
  if (!ids.has(request.survivorId) || !ids.has(request.loserId)) {
    throw new DecisionError('the survivor and the loser must both be records this item compares');
  }
  if (request.survivorId === request.loserId) {
    throw new DecisionError('a record cannot be merged into itself');
  }
  const merged = view.candidates.find(
    (candidate) => candidate.patientId === request.loserId && candidate.mergedInto !== null,
  );
  if (merged !== undefined) {
    throw new DecisionError('that record has already been merged away; reload the item');
  }

  const fieldDecisions: Record<string, FieldDecision> = {};
  for (const [field, decision] of Object.entries(request.decisions)) {
    const property = PROPERTY_OF[field];
    if (property === undefined) throw new DecisionError(`${field} is not a field of the person`);
    fieldDecisions[property] = decision;
  }

  return {
    kind: 'merge',
    survivorId: request.survivorId,
    loserId: request.loserId,
    fieldDecisions: fieldDecisions,
    note: request.note,
    resolution: {
      action: 'merge',
      survivor: request.survivorId,
      loser: request.loserId,
      decided: Object.keys(request.decisions).sort(),
    },
  };
}
