// The query string is the queue's state, and anyone may edit it. Pure, so these are unit tests.
import { describe, expect, it } from 'vitest';

import { DEFAULT_FILTERS } from '@/repo/queue';

import { intakeStateEnum, reviewItemTypeEnum } from '@/db/schema';
import type { IntakeState } from '@/intake/machine';

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

// The default view is every intake waiting for a person (docs/reviewer-day.md). `auto_cleared` is
// the brief's "clear for doctor review" — a doctor's inbox, not a finished case — and an
// `auto_rejected` intake nobody opens is a machine taking the final decision on a person's
// eligibility, which is why ADR-0014 keeps the auto_rejected → in_review edge. Placing every state
// on one side or the other is what stops the view drifting back to a narrower one.
describe('the default view', () => {
  const WAITING_FOR_A_PERSON: readonly IntakeState[] = [
    'auto_cleared',
    'auto_flagged',
    'auto_rejected',
    'in_review',
  ];

  /** Not yet a person's to do (`draft`, `submitted`), already decided, or history. */
  const NOT_WAITING: readonly IntakeState[] = [
    'draft',
    'submitted',
    'approved',
    'rejected',
    'legacy_pending',
    'legacy_approved',
    'legacy_rejected',
    'legacy_expired',
  ];

  it('holds exactly the intake states waiting for a person', () => {
    expect([...DEFAULT_FILTERS.states].sort()).toEqual([...WAITING_FOR_A_PERSON].sort());
  });

  it('leaves out the states nobody is waiting on, which the filter still offers', () => {
    for (const state of NOT_WAITING) {
      expect(DEFAULT_FILTERS.states).not.toContain(state);
      expect(STATE_ORDER).toContain(state);
    }
  });

  // A thirteenth state has to be put on one side or the other, here and in reviewer-day.md.
  it('accounts for every state of the enum, in or out', () => {
    expect([...WAITING_FOR_A_PERSON, ...NOT_WAITING].sort()).toEqual(
      [...intakeStateEnum.enumValues].sort(),
    );
  });

  it('holds every review-item type, open only, because an open item is work', () => {
    expect([...DEFAULT_FILTERS.types].sort()).toEqual([...reviewItemTypeEnum.enumValues].sort());
    expect(DEFAULT_FILTERS.status).toBe('open');
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
