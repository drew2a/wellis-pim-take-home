// The queue's filters are the URL (ADR-0024): a reviewer can keep a filtered queue in a tab, and
// the page needs no client state to render one. This module is the boundary between a query string
// — which anyone may edit, mangle or bookmark — and the typed filters the repository takes.
//
// An unknown value is dropped rather than thrown on: a query string is not a request body, and a
// mistyped link should show a reviewer an empty queue with the filters it did apply, not a 500.
import { intakeStateEnum, reviewItemStatusEnum, reviewItemTypeEnum } from '@/db/schema';
import type { ReviewItemType } from '@/import/review/items';
import type { IntakeState } from '@/intake/machine';
import { DEFAULT_FILTERS, type QueueAge, type QueueFilters } from '@/repo/queue';

export type SearchParams = Record<string, string | string[] | undefined>;

const AGES: readonly QueueAge[] = ['today', 'week', 'older'];

/**
 * Every review-item type, and every intake state, as filters — in the order a reviewer meets them
 * rather than the order the enums declare them, which starts with 2917 legacy rows. Both are
 * exhaustive by type and by test: a state that is not offered is a state nobody can reach, and
 * `draft`, `submitted` and `legacy_expired` are offered and legitimately empty (ADR-0023 item 1).
 */
export const ITEM_TYPE_ORDER: readonly ReviewItemType[] = [
  'identity_conflict',
  'orphan_intake',
  'duplicate_intake',
  'consent',
  'data_quality',
  'vocabulary',
  'clinical_history',
];

export const STATE_ORDER: readonly IntakeState[] = [
  'auto_flagged',
  'auto_rejected',
  'auto_cleared',
  'in_review',
  'approved',
  'rejected',
  'legacy_pending',
  'legacy_approved',
  'legacy_rejected',
  'legacy_expired',
  'draft',
  'submitted',
];

const values = (param: string | string[] | undefined): string[] =>
  param === undefined ? [] : Array.isArray(param) ? param : [param];

const only = <T extends string>(param: string | string[] | undefined, allowed: readonly T[]): T[] =>
  values(param).filter((value): value is T => (allowed as readonly string[]).includes(value));

const first = <T extends string>(
  param: string | string[] | undefined,
  allowed: readonly T[],
): T | undefined => only(param, allowed)[0];

/**
 * The filters a query string asks for. With no `type` and no `state` at all it is the default view
 * of `docs/reviewer-day.md`; naming either one means the reviewer has chosen, and the other is
 * empty rather than quietly still at its default.
 */
export function filtersFrom(params: SearchParams): QueueFilters {
  const types = only<ReviewItemType>(params.type, reviewItemTypeEnum.enumValues);
  const states = only<IntakeState>(params.state, intakeStateEnum.enumValues);
  const chosen = params.type !== undefined || params.state !== undefined;
  return {
    types: chosen ? types : DEFAULT_FILTERS.types,
    states: chosen ? states : DEFAULT_FILTERS.states,
    status: first(params.status, reviewItemStatusEnum.enumValues) ?? DEFAULT_FILTERS.status,
    age: first(params.age, AGES),
  };
}

/** The URL for the queue with one selection toggled, everything else as it is. */
export function toggled(params: SearchParams, key: 'type' | 'state', value: string): string {
  const current = filtersFrom(params);
  const selected = new Set<string>(key === 'type' ? current.types : current.states);
  if (selected.has(value)) selected.delete(value);
  else selected.add(value);

  const other = key === 'type' ? current.states : current.types;
  const query = new URLSearchParams();
  for (const each of selected) query.append(key, each);
  for (const each of other) query.append(key === 'type' ? 'state' : 'type', each);
  if (current.status !== DEFAULT_FILTERS.status) query.set('status', current.status);
  if (current.age !== undefined) query.set('age', current.age);
  // With nothing selected the URL would read as "no filters" and mean "the default view", so the
  // empty selection is said out loud.
  if (selected.size === 0 && other.length === 0) query.set(key, '');
  return `/console?${query.toString()}`;
}

/** The URL with one single-valued filter set, or cleared when it is already what it would be. */
export function withParam(
  params: SearchParams,
  key: 'status' | 'age',
  value: string | undefined,
): string {
  const current = filtersFrom(params);
  const query = new URLSearchParams();
  const chosen = params.type !== undefined || params.state !== undefined;
  if (chosen) {
    for (const each of current.types) query.append('type', each);
    for (const each of current.states) query.append('state', each);
    if (current.types.length === 0 && current.states.length === 0) query.set('type', '');
  }
  const status = key === 'status' ? value : current.status;
  const age = key === 'age' ? value : current.age;
  if (status !== undefined && status !== DEFAULT_FILTERS.status) query.set('status', status);
  if (age !== undefined) query.set('age', age);
  const search = query.toString();
  return search === '' ? '/console' : `/console?${search}`;
}

/**
 * The filters as a query string, for a link that is not the queue itself: opening a row keeps the
 * queue it was opened from, so the three panes agree about what the list is (ADR-0028).
 */
export function queryOf(params: SearchParams): string {
  const query = new URLSearchParams();
  const chosen = params.type !== undefined || params.state !== undefined;
  const current = filtersFrom(params);
  if (chosen) {
    for (const each of current.types) query.append('type', each);
    for (const each of current.states) query.append('state', each);
    if (current.types.length === 0 && current.states.length === 0) query.set('type', '');
  }
  if (current.status !== DEFAULT_FILTERS.status) query.set('status', current.status);
  if (current.age !== undefined) query.set('age', current.age);
  const search = query.toString();
  return search === '' ? '' : `?${search}`;
}
