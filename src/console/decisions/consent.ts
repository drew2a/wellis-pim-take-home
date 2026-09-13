// Resolving a `consent` item: 83 of them — 7 where the log contradicts itself, 19 where the patient
// is active with consent revoked, 57 where an active or paused patient has no record at all
// (ADR-0011 item 22).
//
// **Nothing here writes a consent event.** An event is what the patient did; a reviewer's finding
// is not, and a row that says `granted` at a timestamp would be indistinguishable from one the log
// supplied (`CLAUDE.md` §5, §6). What a reviewer records is what they did about it: contacted the
// patient, obtained consent on paper, paused processing — as a note, on the record, against the
// patient.
//
// The third action is for the seven logs that contradict themselves — a revocation before any
// grant. No rule can say what is true there, so a person finds out and **establishes** the state
// (ADR-0025). The decision is the audit entry; the `consent_states` row is its cache, kept while
// the evidence it was taken over is still the latest and superseded by an event that orders after
// it. Only a `conflict` may be established: a revocation that is unambiguous is not something a
// reviewer overrides, it is something the business acts on.
import { z } from 'zod';

import type { reviewItems } from '@/db/schema';

import { DecisionError, type Decision } from './types';

export const CONSENT_STATES = ['granted', 'revoked'] as const;

export const consentRequestSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('resolve'),
      note: z.string().trim().min(1, 'say what was done, in a sentence'),
    })
    .strict(),
  z
    .object({
      action: z.literal('dismiss'),
      note: z.string().trim().min(1, 'say why, in a sentence'),
    })
    .strict(),
  z
    .object({
      action: z.literal('set_state'),
      note: z.string().trim().min(1, 'say what you established, and how'),
      state: z.enum(CONSENT_STATES),
    })
    .strict(),
]);

export type ConsentRequest = z.infer<typeof consentRequestSchema>;

export interface ConsentDecision {
  readonly decision: Decision;
  /** Present only on `set_state`: the state to write, after the decision is recorded. */
  readonly establish: {
    readonly patientId: string;
    readonly type: string;
    readonly state: (typeof CONSENT_STATES)[number];
  } | null;
}

export function decideConsent(
  item: typeof reviewItems.$inferSelect,
  request: ConsentRequest,
  /** The state derived from the log right now, which `set_state` may only override on a conflict. */
  derived: string | null,
): ConsentDecision {
  if (item.patientId === null) {
    throw new DecisionError(`review item ${item.id} names no patient`);
  }
  const type = item.field;

  if (request.action !== 'set_state') {
    return {
      decision: {
        outcome: request.action === 'resolve' ? 'resolved' : 'dismissed',
        note: request.note,
        // A consent state is derived from the log, and nothing here writes a consent event.
        changes: [],
        subjects: [{ entityType: 'patient', entityId: item.patientId }],
        resolution: { action: request.action, consent_type: type },
      },
      establish: null,
    };
  }

  if (type === null) throw new DecisionError(`review item ${item.id} names no consent type`);
  // Only a log that contradicts itself. A clear `revoked` is acted on, not overridden (ADR-0025 §3).
  if (derived !== 'conflict') {
    throw new DecisionError(
      `only a consent state of conflict can be established by hand; this one is ${derived ?? 'unknown'}`,
    );
  }

  return {
    decision: {
      outcome: 'resolved',
      note: request.note,
      changes: [],
      subjects: [
        {
          entityType: 'patient',
          entityId: item.patientId,
          // Not a column, which is why it goes here and not through a field change: the row it
          // becomes is a cache of this entry (ADR-0025 item 1).
          changes: [{ field: `consent_state:${type}`, from: derived, to: request.state }],
        },
      ],
      resolution: { action: 'set_state', consent_type: type, state: request.state, was: derived },
    },
    establish: { patientId: item.patientId, type, state: request.state },
  };
}
