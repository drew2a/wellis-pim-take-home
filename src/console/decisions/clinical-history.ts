// Resolving a `clinical_history` item: 115 of them — 42 GLP-1 medications named in free text, 15
// flag conditions, 58 patients who were under 18 at submission and were approved or left pending.
//
// These are the cases the legacy process **could not see** or where the question is a legal one
// (ADR-0005). Today's rules disagreeing with a 2024 outcome is not one of them: the doctor who
// approved that intake saw its BMI, and a disagreement about the rules is a shadow evaluation to
// browse, not an item to close.
//
// **The historical outcome never changes.** Nothing here writes a column, and the item's audit
// entry carries both states null: something happened, and nothing transitioned (ADR-0014 item 7,
// `CLAUDE.md` §5 — detectors must not rewrite historical outcomes).
import { z } from 'zod';

import type { reviewItems } from '@/db/schema';

import { DecisionError, type Decision } from './types';

export const clinicalHistoryRequestSchema = z.discriminatedUnion('action', [
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

export type ClinicalHistoryRequest = z.infer<typeof clinicalHistoryRequestSchema>;

export function decideClinicalHistory(
  item: typeof reviewItems.$inferSelect,
  request: ClinicalHistoryRequest,
): Decision {
  if (item.intakeId === null) {
    throw new DecisionError(`review item ${item.id} names no intake`);
  }
  return {
    outcome: request.action === 'resolve' ? 'resolved' : 'dismissed',
    note: request.note,
    changes: [],
    subjects: [{ entityType: 'intake', entityId: item.intakeId }],
    resolution: { action: request.action },
  };
}
