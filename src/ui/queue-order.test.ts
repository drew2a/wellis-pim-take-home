// What the "newest first" toggle does to the page the server rendered (`docs/reviewer-day.md`,
// ADR-0031 §1: it flips the age inside each group and never moves the groups past one another).
import { describe, expect, it } from 'vitest';

import { ordered } from './queue-order';
import type { QueueKind } from '@/repo/queue';

const row = (
  kind: QueueKind,
  title: string,
): { readonly kind: QueueKind; readonly title: string } => ({ kind, title });

// The order the query returns: both intakes, then both items, each group oldest first.
const PAGE = [
  row('intake', 'older intake'),
  row('intake', 'newer intake'),
  row('review_item', 'older item'),
  row('review_item', 'newer item'),
];

describe('the order the queue is read in', () => {
  it('leaves the query’s order alone when the toggle is off', () => {
    expect(ordered(PAGE, false)).toBe(PAGE);
  });

  it('reverses the age inside each group, and does not move people below data', () => {
    expect(ordered(PAGE, true).map((r) => r.title)).toEqual([
      'newer intake',
      'older intake',
      'newer item',
      'older item',
    ]);
  });

  // The grouping is the query's to decide (`@/repo/queue`), and the toggle is not a second opinion
  // on it: whatever order of kinds the server sends is the order of kinds the reviewer keeps.
  it('leaves the kinds where the server put them, grouped or not', () => {
    const interleaved = [
      row('review_item', 'first'),
      row('intake', 'second'),
      row('review_item', 'third'),
    ];
    expect(ordered(interleaved, true).map((r) => r.kind)).toEqual(interleaved.map((r) => r.kind));
    expect(ordered(PAGE, true).map((r) => r.kind)).toEqual(PAGE.map((r) => r.kind));
  });
});
