// The "newest first" toggle (ADR-0028 §3: sorting is a client-side reverse of the rendered page).
import { describe, expect, it } from 'vitest';

import { ordered, type QueueKind } from './queue-order';

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
});
