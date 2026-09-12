// Review items (ADR-0004): a decision the importer could not make safely, handed to a human.
// dedupe_key is deterministic from type, entity (natural key), field, rule and raw value, so a
// re-run neither duplicates an open item nor re-opens a resolved one (R-A15, R-A17). Insert is
// ON CONFLICT DO NOTHING on that key.
import { reviewItems } from '@/db/schema';

import type { Queryable } from '@/db/queryable';

export type ReviewItemType =
  | 'data_quality'
  | 'identity_conflict'
  | 'orphan_intake'
  | 'duplicate_intake'
  | 'consent'
  | 'clinical_history'
  | 'vocabulary';

export type ReviewItemScope = 'row' | 'vocabulary';

/** A proposal is data on the item, applied only by a human through the resolution path (ADR-0005). */
export interface ProposedResolution {
  readonly field: string;
  readonly proposed_value: string;
  readonly rule: string;
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface ReviewItemDraft {
  readonly type: ReviewItemType;
  readonly scope: ReviewItemScope;
  readonly title: string;
  readonly reason: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly proposedResolution: ProposedResolution | null;
  readonly patientId: string | null;
  readonly intakeId: string | null;
  readonly field: string | null;
  readonly dedupeKey: string;
}

/**
 * `type|scope|entity|field|rule|raw`. Parts are natural keys and raw strings, never uuids, so the
 * key is the same on every run and before any canonical row exists. `|` inside a raw value is
 * escaped so two different raw values cannot collide.
 */
export function dedupeKey(parts: readonly (string | null)[]): string {
  return parts.map((p) => (p ?? '').replaceAll('\\', '\\\\').replaceAll('|', '\\|')).join('|');
}

/** Position of the rule in a dedupe key, the one part the report groups items by. */
const RULE_PART = 4;

/** The inverse of `dedupeKey`: the parts, with the escaping undone. */
export function dedupeParts(key: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < key.length; i += 1) {
    const char = key.charAt(i);
    if (char === '\\') {
      current += key.charAt(i + 1);
      i += 1;
    } else if (char === '|') {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

/**
 * The rule a stored item was raised by. The rule is not a column: `dedupe_key` is the only place
 * it is written down (ADR-0004), and the import report groups by it, so it is read back here
 * rather than re-derived from a title, which carries per-row text.
 */
export function ruleOf(dedupeKeyValue: string): string {
  const rule = dedupeParts(dedupeKeyValue)[RULE_PART];
  if (rule === undefined || rule === '') {
    throw new Error(`review item dedupe key names no rule: ${dedupeKeyValue}`);
  }
  return rule;
}

const CHUNK = 200;

/** Returns the number of items this run created; the rest already existed. */
export async function insertReviewItems(
  db: Queryable,
  runId: number,
  drafts: readonly ReviewItemDraft[],
): Promise<number> {
  const seen = new Set<string>();
  for (const draft of drafts) {
    if (seen.has(draft.dedupeKey)) {
      throw new Error(`two review items in one run share dedupe_key ${draft.dedupeKey}`);
    }
    seen.add(draft.dedupeKey);
  }
  let inserted = 0;
  for (let i = 0; i < drafts.length; i += CHUNK) {
    const returned = await db
      .insert(reviewItems)
      .values(
        drafts.slice(i, i + CHUNK).map((d) => ({
          type: d.type,
          scope: d.scope,
          title: d.title,
          reason: d.reason,
          payload: d.payload,
          proposedResolution: d.proposedResolution,
          patientId: d.patientId,
          intakeId: d.intakeId,
          field: d.field,
          dedupeKey: d.dedupeKey,
          createdByRun: runId,
        })),
      )
      .onConflictDoNothing({ target: reviewItems.dedupeKey })
      .returning({ id: reviewItems.id });
    inserted += returned.length;
  }
  return inserted;
}
