// Resolving a vocabulary item: one decision for a human, however many rows it touches
// (`CLAUDE.md` §5). Ten of them on this export — the date convention, `OK` = approved, `2.0` = v2,
// the 18 unit-less weights, `n.v.t.`, bsn retention, and the rest.
//
// Two of the three answers change nothing, and that is not a gap. Confirming an inference the
// importer already applied leaves every row as it is; **rejecting** one does not rewrite anything
// either, because the rule that produced those rows lives in `rules/v1.json` and a changed rule is
// a new ruleset and a re-import (ADR-0005: "if a human says no, the records identify exactly which
// rows to remap"). What the console does is record the answer, against the rows it applies to.
//
// The exception is the item ADR-0005 designed a payload for: 18 weights with no unit, each row
// carrying both readings and both BMIs, where confirming *is* the write.
import { z } from 'zod';

import type { reviewItems } from '@/db/schema';
import type { FieldChange } from '@/repo/resolve';

import { DecisionError, type Decision, type LegacyPatientLookup } from './types';

/** The rule whose confirmation writes values. Every other vocabulary rule records an answer. */
const WEIGHTS_AS_POUNDS = 'WEIGHT_UNIT_MISSING_TO_NULL';

export const vocabularyRequestSchema = z
  .object({
    action: z.enum(['confirm', 'reject', 'dismiss']),
    note: z.string().trim().min(1, 'say why, in a sentence'),
    /** Legacy ids the reviewer took out before applying. Meaningless on the other actions. */
    excluded: z.array(z.string()).default([]),
  })
  .strict();

export type VocabularyRequest = z.infer<typeof vocabularyRequestSchema>;

/** The rows of the unit-less-weights item, as ADR-0005 specified them: both readings, both BMIs. */
const reading = z.object({ weight_kg: z.string(), bmi: z.number().optional() });

const poundsPayloadSchema = z.object({
  rows: z.array(
    z.object({
      legacy_id: z.string(),
      raw_weight: z.string().optional(),
      height_cm: z.number().nullable().optional(),
      as_pounds: reading,
      as_kilograms: reading.optional(),
    }),
  ),
});

export type PoundsRow = z.infer<typeof poundsPayloadSchema>['rows'][number];

/**
 * The rows the screen shows with a checkbox each. Empty for every other rule, which is what makes
 * the row list appear on exactly the item whose confirmation is a write.
 */
export function poundsRowsOf(
  item: typeof reviewItems.$inferSelect,
  rule: string,
): readonly PoundsRow[] {
  if (rule !== WEIGHTS_AS_POUNDS) return [];
  const payload = poundsPayloadSchema.safeParse(item.payload);
  return payload.success ? payload.data.rows : [];
}

export function decideVocabulary(
  item: typeof reviewItems.$inferSelect,
  rule: string,
  request: VocabularyRequest,
  patientOf: LegacyPatientLookup,
): Decision {
  const outcome = request.action === 'dismiss' ? 'dismissed' : 'resolved';
  const base = { outcome, note: request.note } as const;

  if (rule !== WEIGHTS_AS_POUNDS || request.action !== 'confirm') {
    return { ...base, changes: [], resolution: { rule, action: request.action } };
  }

  const payload = poundsPayloadSchema.safeParse(item.payload);
  if (!payload.success) {
    throw new DecisionError(`review item ${item.id} does not carry the rows this rule applies to`);
  }
  const excluded = new Set(request.excluded);
  const unknown = request.excluded.filter(
    (legacyId) => !payload.data.rows.some((row) => row.legacy_id === legacyId),
  );
  // An exclusion that matches no row means the screen and the item have drifted apart, and
  // applying the rest would silently write rows the reviewer thought they had taken out.
  if (unknown.length > 0) {
    throw new DecisionError(`${unknown.join(', ')} is not a row of this item`);
  }

  const changes: FieldChange[] = [];
  for (const row of payload.data.rows) {
    if (excluded.has(row.legacy_id)) continue;
    const patientId = patientOf.get(row.legacy_id);
    if (patientId === undefined) {
      throw new DecisionError(`legacy row ${row.legacy_id} has no canonical patient`);
    }
    changes.push({
      entityType: 'patient',
      entityId: patientId,
      field: 'weight_kg',
      value: row.as_pounds.weight_kg,
    });
  }

  return {
    ...base,
    changes,
    resolution: {
      rule,
      action: 'confirm',
      applied_to: changes.length,
      excluded: [...excluded].sort(),
    },
  };
}

/** The legacy ids a vocabulary item's decision may need to resolve, so the route can look them up. */
export function legacyIdsOf(item: typeof reviewItems.$inferSelect, rule: string): string[] {
  if (rule !== WEIGHTS_AS_POUNDS) return [];
  const payload = poundsPayloadSchema.safeParse(item.payload);
  return payload.success ? payload.data.rows.map((row) => row.legacy_id) : [];
}
