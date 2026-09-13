// Resolving a `duplicate_intake`: five (patient, day) pairs, three with consecutive ids, weights
// one to three kilograms apart (ADR-0006).
//
// **Both intakes stay, whatever is decided.** Neither is deleted and neither outcome is rewritten:
// what the legacy process recorded is evidence (`CLAUDE.md` §5). The decision is which of the two
// is the record of note, and that is a fact written into the audit and onto the item — it changes
// no column on either row.
import { z } from 'zod';

import type { reviewItems } from '@/db/schema';

import { DecisionError, type Decision } from './types';

export const duplicateRequestSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('keep_one'),
      note: z.string().trim().min(1, 'say why, in a sentence'),
      /** The exported id of the intake that is the record of note. */
      intakeId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal('keep_both'),
      note: z.string().trim().min(1, 'say why, in a sentence'),
    })
    .strict(),
]);

export type DuplicateRequest = z.infer<typeof duplicateRequestSchema>;

const payloadSchema = z.object({
  intakes: z.array(z.object({ intake_id: z.string() })).min(2),
});

/** The exported ids a same-day pair is about, so the route can resolve them to canonical rows. */
export function pairedIntakeIds(item: typeof reviewItems.$inferSelect): string[] {
  const payload = payloadSchema.safeParse(item.payload);
  return payload.success ? payload.data.intakes.map((intake) => intake.intake_id) : [];
}

export function decideDuplicate(
  item: typeof reviewItems.$inferSelect,
  request: DuplicateRequest,
  /** Exported intake id to canonical uuid, for the pair this item names. */
  canonical: ReadonlyMap<string, string>,
): Decision {
  const paired = pairedIntakeIds(item);
  if (paired.length < 2) {
    throw new DecisionError(`review item ${item.id} does not carry a pair of intakes`);
  }
  const subjects = paired.flatMap((intakeId) => {
    const id = canonical.get(intakeId);
    if (id === undefined) throw new DecisionError(`intake ${intakeId} has no canonical row`);
    return [{ entityType: 'intake', entityId: id }];
  });

  if (request.action === 'keep_both') {
    return {
      outcome: 'dismissed',
      note: request.note,
      changes: [],
      subjects,
      resolution: { action: 'keep_both', intakes: paired },
    };
  }
  if (!paired.includes(request.intakeId)) {
    throw new DecisionError(`${request.intakeId} is not one of this pair`);
  }
  return {
    outcome: 'resolved',
    note: request.note,
    changes: [],
    subjects,
    resolution: {
      action: 'keep_one',
      record_of_note: request.intakeId,
      also_kept: paired.filter((intakeId) => intakeId !== request.intakeId),
    },
  };
}
