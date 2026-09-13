// One colour vocabulary for the whole product, and the two maps that assign it.
//
// The maps are keyed by the enum types themselves, so adding an intake state or a review-item type
// without choosing its colour fails `tsc`. They live here rather than beside the `pgEnum`
// declarations because they hold Tailwind class strings, and class strings live only in `src/ui/`
// (see `./index.ts`); the type-only imports are erased at compile time, so a client component
// picking up a badge colour does not pull the database layer into the browser bundle.
import type { ReviewItemType } from '@/import/review/items';
import type { IntakeState } from '@/intake/machine';

/**
 * A colour and what it means. Colour in this product only ever marks a state or a kind — nothing
 * is tinted for decoration — so this list is deliberately short and every entry is spoken for.
 */
export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral' | 'accent' | 'plum' | 'clay';

/** Soft ground, readable ink, a border a shade darker than the ground. */
export const TONE_CLASSES: Readonly<Record<Tone, string>> = {
  good: 'bg-good-50 text-good-700 border-good-200',
  warn: 'bg-warn-50 text-warn-700 border-warn-200',
  bad: 'bg-bad-50 text-bad-700 border-bad-200',
  info: 'bg-info-50 text-info-700 border-info-200',
  neutral: 'bg-grey-100 text-grey-700 border-grey-300',
  accent: 'bg-accent-50 text-accent-700 border-accent-200',
  plum: 'bg-plum-50 text-plum-700 border-plum-200',
  clay: 'bg-clay-50 text-clay-700 border-clay-200',
};

/**
 * The same eight colours as a solid dot — the kind marker in the rail and beside every queue row.
 * A dot is a shape, not text, so it takes the ink shade of its tone and needs no ground.
 */
export const DOT_CLASSES: Readonly<Record<Tone, string>> = {
  good: 'bg-good-700',
  warn: 'bg-warn-700',
  bad: 'bg-bad-700',
  info: 'bg-info-700',
  neutral: 'bg-grey-600',
  accent: 'bg-accent-600',
  plum: 'bg-plum-700',
  clay: 'bg-clay-700',
};

/**
 * Intake states, coloured by what the state means to the person reading it: cleared and approved
 * are good, rejected is bad, flagged wants attention, in_review is in hand. The states that carry
 * no verdict — `draft`, `submitted` and everything the importer wrote as `legacy_*` — are grey,
 * because a legacy outcome is history, not a decision this system made (ADR-0014).
 */
export const STATE_TONES: Readonly<Record<IntakeState, Tone>> = {
  legacy_approved: 'neutral',
  legacy_rejected: 'neutral',
  legacy_pending: 'neutral',
  legacy_expired: 'neutral',
  draft: 'neutral',
  submitted: 'neutral',
  auto_cleared: 'good',
  auto_flagged: 'warn',
  auto_rejected: 'bad',
  in_review: 'info',
  approved: 'good',
  rejected: 'bad',
};

/**
 * Review-item types: one hue each, so a reviewer scanning a queue can tell the kinds apart at a
 * glance. These are kinds of work, not verdicts — the hue carries no good/bad reading.
 */
export const REVIEW_ITEM_TONES: Readonly<Record<ReviewItemType, Tone>> = {
  data_quality: 'warn',
  identity_conflict: 'plum',
  orphan_intake: 'clay',
  duplicate_intake: 'info',
  consent: 'accent',
  clinical_history: 'bad',
  vocabulary: 'neutral',
};

/**
 * The tone for a state that arrived as a plain `string` — from the API, for instance. Unknown
 * states fall to grey rather than to nothing, because the client is defensive about the network
 * (`CLAUDE.md` §2); inside the server a state is an `IntakeState` and `STATE_TONES` is total.
 */
const BY_STATE: ReadonlyMap<string, Tone> = new Map(Object.entries(STATE_TONES));

export const toneForState = (state: string): Tone => BY_STATE.get(state) ?? 'neutral';

/** The same, for a review-item type that arrived as a plain `string` — a queue row's `type`. */
const BY_ITEM_TYPE: ReadonlyMap<string, Tone> = new Map(Object.entries(REVIEW_ITEM_TONES));

export const toneForReviewItem = (type: string): Tone => BY_ITEM_TYPE.get(type) ?? 'neutral';

/** `auto_cleared` → `auto cleared`. The enum value is the vocabulary; this only makes it readable. */
export const humanise = (value: string): string => value.replace(/_/g, ' ');

/** The same, where the label starts a line of its own — a rail entry, a queue row's kind. */
export const titled = (value: string): string => {
  const text = humanise(value);
  return text.charAt(0).toUpperCase() + text.slice(1);
};
