// ADR-0028: the shell marks the row whose id is the route's, so "where am I" is rendered and not
// inferred, and ↑ / ↓ move by exactly one row of the list as filtered.
import { describe, expect, it } from 'vitest';

import type { QueueRow } from '@/repo/queue';

import { hrefOf, placeIn } from './place';

const row = (kind: QueueRow['kind'], id: string): QueueRow => ({
  kind,
  id,
  type: kind === 'intake' ? 'auto_flagged' : 'consent',
  title: id,
  patientId: null,
  patientName: null,
  age: null,
  status: 'open',
});

const ROWS = [
  row('review_item', 'a'),
  row('intake', 'b'),
  row('review_item', 'c'),
] as const satisfies readonly QueueRow[];

describe('a row of the queue as a link', () => {
  it('sends a review item and an intake to their own routes', () => {
    expect(hrefOf({ kind: 'review_item', id: 'a' }, '')).toBe('/console/items/a');
    expect(hrefOf({ kind: 'intake', id: 'b' }, '')).toBe('/console/intakes/b');
  });

  it('carries the queue it was opened from, so the filters survive the click', () => {
    expect(hrefOf({ kind: 'review_item', id: 'a' }, '?type=consent')).toBe(
      '/console/items/a?type=consent',
    );
  });
});

describe('where the open row sits in the queue', () => {
  it('counts from one, and names the whole list', () => {
    expect(placeIn(ROWS, { kind: 'intake', id: 'b' }, '').position).toBe('2 of 3');
  });

  it('steps by exactly one row in each direction', () => {
    const place = placeIn(ROWS, { kind: 'intake', id: 'b' }, '');
    expect(place.prevHref).toBe('/console/items/a');
    expect(place.nextHref).toBe('/console/items/c');
  });

  // An id is unique per table, not across them: a review item and an intake may share one, and
  // matching on the id alone would mark — and step from — the wrong row.
  it('matches on the kind as well as the id', () => {
    const rows = [row('review_item', 'x'), row('intake', 'x')];
    expect(placeIn(rows, { kind: 'intake', id: 'x' }, '').position).toBe('2 of 2');
  });

  it('points nowhere past either end', () => {
    expect(placeIn(ROWS, { kind: 'review_item', id: 'a' }, '').prevHref).toBeNull();
    expect(placeIn(ROWS, { kind: 'review_item', id: 'c' }, '').nextHref).toBeNull();
  });

  // A resolved item reached from a link, or an intake opened from a patient's record: it is not in
  // this list, so the pane says nothing about a position rather than inventing one.
  it('says nothing when the open row is not in the list', () => {
    expect(placeIn(ROWS, { kind: 'review_item', id: 'gone' }, '')).toEqual({
      position: null,
      prevHref: null,
      nextHref: null,
    });
  });

  it('says nothing when nothing is open', () => {
    expect(placeIn(ROWS, null, '').position).toBeNull();
  });
});
