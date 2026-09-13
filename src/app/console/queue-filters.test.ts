// The query string is the queue's state, and anyone may edit it. Pure, so these are unit tests.
import { describe, expect, it } from 'vitest';

import { DEFAULT_FILTERS } from '@/repo/queue';

import { intakeStateEnum, reviewItemTypeEnum } from '@/db/schema';

import { filtersFrom, ITEM_TYPE_ORDER, STATE_ORDER, toggled, withParam } from './queue-filters';

// Every value of both enums is an offered filter, so no work is invisible and the counts beside
// them are total (docs/console-stories.md S-3, ADR-0023 item 1).
describe('the filters on offer', () => {
  it('are every review-item type, once each', () => {
    expect([...ITEM_TYPE_ORDER].sort()).toEqual([...reviewItemTypeEnum.enumValues].sort());
  });

  it('are every intake state, once each — the three that can have no rows included', () => {
    expect([...STATE_ORDER].sort()).toEqual([...intakeStateEnum.enumValues].sort());
    expect(STATE_ORDER).toContain('legacy_expired');
    expect(STATE_ORDER).toContain('draft');
  });
});

describe('filtersFrom', () => {
  it('is the default view when nothing is asked for', () => {
    expect(filtersFrom({})).toEqual(DEFAULT_FILTERS);
  });

  it('takes the types and states named', () => {
    expect(filtersFrom({ type: ['consent', 'vocabulary'], state: 'in_review' })).toMatchObject({
      types: ['consent', 'vocabulary'],
      states: ['in_review'],
    });
  });

  // Naming one is choosing: the other is empty, not still at its default, or a reviewer who ticked
  // one item type would silently keep six intake states they never asked for.
  it('empties the other side when only one is named', () => {
    expect(filtersFrom({ type: 'consent' }).states).toEqual([]);
    expect(filtersFrom({ state: 'in_review' }).types).toEqual([]);
  });

  it('reads an empty selection as an empty selection, not as the default', () => {
    expect(filtersFrom({ type: '' })).toMatchObject({ types: [], states: [] });
  });

  it('drops a value that is not a type, a state, a status or an age', () => {
    expect(filtersFrom({ type: ['consent', 'nonsense'] }).types).toEqual(['consent']);
    expect(filtersFrom({ status: 'whenever' }).status).toBe('open');
    expect(filtersFrom({ age: 'yesterday' }).age).toBeUndefined();
  });

  it('defaults the status to open, because that is the work still to do', () => {
    expect(filtersFrom({}).status).toBe('open');
    expect(filtersFrom({ status: 'dismissed' }).status).toBe('dismissed');
  });
});

describe('toggled', () => {
  it('adds a type that is not selected', () => {
    expect(toggled({ type: 'consent' }, 'type', 'vocabulary')).toBe(
      '/console?type=consent&type=vocabulary',
    );
  });

  it('removes one that is', () => {
    expect(toggled({ type: ['consent', 'vocabulary'] }, 'type', 'consent')).toBe(
      '/console?type=vocabulary',
    );
  });

  it('keeps the other side, the status and the age', () => {
    const url = toggled({ type: 'consent', state: 'in_review', age: 'week' }, 'type', 'vocabulary');
    expect(url).toContain('state=in_review');
    expect(url).toContain('age=week');
  });

  // The default view is what a reviewer sees before they choose, not a selection they made. Read
  // as one, the first click on a kind selected the other six types and both intake states.
  it('selects just that kind on the first click from the default view', () => {
    expect(toggled({}, 'type', 'consent')).toBe('/console?type=consent');
    expect(toggled({}, 'state', 'in_review')).toBe('/console?state=in_review');
  });

  // Clicking the row you are already on is how anyone undoes a filter; landing on an empty queue
  // is not an undo. The empty selection stays sayable in a URL — `filtersFrom` honours `type=` —
  // it is just not somewhere a click puts you.
  it('goes back to the default view when the only selected kind is clicked again', () => {
    expect(toggled({ type: 'consent' }, 'type', 'consent')).toBe('/console');
    expect(toggled({ state: 'in_review' }, 'state', 'in_review')).toBe('/console');
  });

  it('keeps the rest of the selection when one of several is clicked off', () => {
    expect(toggled({ type: ['consent', 'vocabulary'] }, 'type', 'vocabulary')).toBe(
      '/console?type=consent',
    );
    expect(toggled({ type: 'consent', state: 'in_review' }, 'type', 'consent')).toBe(
      '/console?state=in_review',
    );
  });
});

describe('withParam', () => {
  it('sets the age and keeps the selection', () => {
    expect(withParam({ type: 'consent' }, 'age', 'today')).toBe('/console?type=consent&age=today');
  });

  it('clears the age when it is cleared', () => {
    expect(withParam({ age: 'today' }, 'age', undefined)).toBe('/console');
  });

  it('leaves the default status out of the URL', () => {
    expect(withParam({ status: 'resolved' }, 'status', 'open')).toBe('/console');
  });

  it('does not write the default view into the URL when the reviewer has not chosen', () => {
    expect(withParam({}, 'age', 'week')).toBe('/console?age=week');
  });
});
