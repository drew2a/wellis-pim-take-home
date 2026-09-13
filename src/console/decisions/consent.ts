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
// The seventh action `docs/reviewer-day.md` asks for — establishing the state on the seven
// conflicts — waits on ADR-0025, because `consent_states` is recomputed on every import and a
// state set today would vanish at the next one with nothing to show for it.
import { z } from 'zod';

import type { reviewItems } from '@/db/schema';

import { DecisionError, type Decision } from './types';

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
]);

export type ConsentRequest = z.infer<typeof consentRequestSchema>;

export function decideConsent(
  item: typeof reviewItems.$inferSelect,
  request: ConsentRequest,
): Decision {
  if (item.patientId === null) {
    throw new DecisionError(`review item ${item.id} names no patient`);
  }
  return {
    outcome: request.action === 'resolve' ? 'resolved' : 'dismissed',
    note: request.note,
    // The consent state is derived from the log and is not a value a reviewer types (ADR-0025).
    changes: [],
    subjects: [{ entityType: 'patient', entityId: item.patientId }],
    resolution: { action: request.action, consent_type: item.field },
  };
}
