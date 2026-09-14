// Resolving a `data_quality` item: 62 of them — 21 emails, 17 BSNs that fail the elfproef, 11
// dates, 5 heights, 5 weights, 3 signup dates. Each is one value the mapper could not read and
// therefore stored as null, with the raw kept (ADR-0005, ADR-0009 item 2).
//
// Three answers. A detector may have attached a **proposal** — `{field, proposed_value, rule,
// evidence}` — and accepting it is not a different mechanism from typing a value: both go through
// the resolution path, which writes the value, the audit entry and the note (ADR-0005 layer 3).
// Dismissing leaves the null and says why.
import { z } from 'zod';

import { elfproef } from '@/import/mapper/bsn';
import type { reviewItems } from '@/db/schema';
import { maskIdentifier } from '@/repo/mask';
import { writableTarget, type FieldChange, type ResolvableEntity } from '@/repo/resolve';

import { DecisionError, type Decision } from './types';

export const dataQualityRequestSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('accept_proposal'),
      note: z.string().trim().min(1, 'say why, in a sentence'),
    })
    .strict(),
  z
    .object({
      action: z.literal('set_value'),
      note: z.string().trim().min(1, 'say why, in a sentence'),
      /** Null blanks the field deliberately, which is not the same as leaving it unresolved. */
      value: z.string().nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal('dismiss'),
      note: z.string().trim().min(1, 'say why, in a sentence'),
    })
    .strict(),
]);

export type DataQualityRequest = z.infer<typeof dataQualityRequestSchema>;

const proposalSchema = z.object({ proposed_value: z.string(), rule: z.string().optional() });

/** The proposal a detector attached, or null. Read strictly: it is `jsonb` (ADR-0023 item 4). */
export function proposalOf(
  item: typeof reviewItems.$inferSelect,
): { value: string; rule: string | null } | null {
  const parsed = proposalSchema.safeParse(item.proposedResolution);
  return parsed.success
    ? { value: parsed.data.proposed_value, rule: parsed.data.rule ?? null }
    : null;
}

/**
 * The identifiers masked in `repeated_row` before it reaches a screen. `bsn` because it is the one
 * identifier in this export and its retention is still an open vocabulary item; `phone` because it
 * reaches a person directly. Not `full_name`, `dob` or `email`: they are how the reviewer tells the
 * two versions of the row apart, and the console shows them on every other item about this patient.
 */
const MASKED_IN_REPEATED_ROW = ['bsn', 'phone'] as const;

/** A raw row as the export gave it: every column a string, because nothing has been read yet. */
const repeatedRowSchema = z.record(z.string(), z.string());

/**
 * The payload as a screen may show it. ADR-0009 item 9 — a natural key the export repeats with
 * different values — deliberately carries `repeated_row` whole and unmasked: the raw table is keyed
 * by that natural key, so the repeated line is stored nowhere else and a redacted copy would lose
 * it. ADR-0009 put the masking on the console and the console never did it (ADR-0030); this is it.
 *
 * Every other payload arrives already masked from the item builder and passes through untouched.
 *
 * Throws rather than renders when `repeated_row` is present but is not a row of strings: a payload
 * the console cannot mask is not a payload it may show.
 */
export function maskedPayload(item: typeof reviewItems.$inferSelect): Record<string, unknown> {
  const payload = item.payload as Record<string, unknown>;
  if (payload.repeated_row === undefined) return payload;

  const row = repeatedRowSchema.parse(payload.repeated_row);
  const masked: Record<string, string> = { ...row };
  for (const field of MASKED_IN_REPEATED_ROW) {
    const value = row[field];
    if (value !== undefined) masked[field] = maskIdentifier(value);
  }
  return { ...payload, repeated_row: masked };
}

/**
 * Which row the item is about: the one that **owns the field**, of the rows the item names, and
 * not simply "the patient if there is one" (ADR-0026 item 2). An unreadable `submitted_at` names
 * both the intake and its patient, and only the intake has that column.
 *
 * Null where no row it names owns the field at all — a consent event's `at`, which was never
 * stored — and such an item can only be dismissed. `writableTarget` is the same function the
 * screen asks, so what the console offers and what the server accepts cannot drift.
 */
function target(item: typeof reviewItems.$inferSelect): {
  entityType: ResolvableEntity;
  entityId: string;
} {
  const found = writableTarget(item);
  if (found === null) throw new DecisionError(`review item ${item.id} names no row to correct`);
  return { entityType: found.entityType, entityId: found.entityId };
}

export function decideDataQuality(
  item: typeof reviewItems.$inferSelect,
  request: DataQualityRequest,
): Decision {
  if (request.action === 'dismiss') {
    return {
      outcome: 'dismissed',
      note: request.note,
      changes: [],
      resolution: { action: 'dismiss', field: item.field },
    };
  }
  if (item.field === null) {
    throw new DecisionError(`review item ${item.id} names no field to correct`);
  }

  let value: string | null;
  if (request.action === 'accept_proposal') {
    const proposal = proposalOf(item);
    if (proposal === null) throw new DecisionError('this item carries no proposal to accept');
    value = proposal.value;
  } else {
    value = request.value;
  }

  const { entityType, entityId } = target(item);
  const changes: FieldChange[] = [{ entityType, entityId, field: item.field, value }];
  // An absent number cannot have been checked valid or invalid, and the database refuses the
  // contradiction (ADR-0008 item 6). The check follows the number, here as in a merge.
  if (entityType === 'patient' && item.field === 'bsn') {
    changes.push({
      entityType,
      entityId,
      field: 'bsn_check',
      value: value === null ? 'absent' : elfproef(value) ? 'valid' : 'invalid',
    });
  }

  return {
    outcome: 'resolved',
    note: request.note,
    changes,
    resolution: { action: request.action, field: item.field, value },
  };
}
