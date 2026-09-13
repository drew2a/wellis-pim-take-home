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

  it('says an empty selection out loud, so it is not read as the default view', () => {
    expect(toggled({ type: 'consent' }, 'type', 'consent')).toBe('/console?type=');
  });

  // The first click from the default view unticks one of the seven types, not all of them.
  it('toggles out of the default view by removing just that one', () => {
    const url = toggled({}, 'type', 'consent');
    expect(url).not.toContain('type=consent');
    expect(url).toContain('type=data_quality');
    expect(url).toContain('state=auto_flagged');
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
