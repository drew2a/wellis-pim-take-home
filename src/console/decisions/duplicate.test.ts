// Pure: what a reviewer's answer on a same-day pair means. Both intakes stay, whatever it is.
import { describe, expect, it } from 'vitest';

import { decideDuplicate, duplicateRequestSchema, pairedIntakeIds } from './duplicate';
import { DecisionError } from './types';

const item = (...intakeIds: readonly string[]): Parameters<typeof decideDuplicate>[0] =>
  ({
    id: 'item-1',
    payload: { intakes: intakeIds.map((intake_id) => ({ intake_id })) },
  }) as Parameters<typeof decideDuplicate>[0];

const pair = item('INT-8342', 'INT-8344');
const canonical: ReadonlyMap<string, string> = new Map([
  ['INT-8342', 'uuid-a'],
  ['INT-8344', 'uuid-b'],
]);

const keepOne = (intakeId = 'INT-8342') =>
  duplicateRequestSchema.parse({
    action: 'keep_one',
    note: 'the later one is the visit',
    intakeId,
  });

describe('marking one as the record of note', () => {
  it('changes no value on either intake', () => {
    expect(decideDuplicate(pair, keepOne(), canonical).changes).toEqual([]);
  });

  // The decision is about both rows, so both carry the audit entry (docs/console-stories.md S-9).
  it('records the decision against both intakes', () => {
    expect(decideDuplicate(pair, keepOne(), canonical).subjects).toEqual([
      { entityType: 'intake', entityId: 'uuid-a' },
      { entityType: 'intake', entityId: 'uuid-b' },
    ]);
  });

  it('says which one was marked and which was kept anyway', () => {
    expect(decideDuplicate(pair, keepOne('INT-8344'), canonical).resolution).toMatchObject({
      record_of_note: 'INT-8344',
      also_kept: ['INT-8342'],
    });
  });

  it('refuses an intake that is not one of the pair', () => {
    expect(() => decideDuplicate(pair, keepOne('INT-9999'), canonical)).toThrow(DecisionError);
  });

  it('refuses a pair whose rows are not in the database', () => {
    expect(() => decideDuplicate(pair, keepOne(), new Map())).toThrow(/no canonical row/);
  });

  it('refuses an item that carries no pair', () => {
    expect(() => decideDuplicate(item('INT-8342'), keepOne(), canonical)).toThrow(/pair/);
  });
});

describe('deciding they are two genuine submissions', () => {
  it('dismisses, changes nothing, and still records it against both', () => {
    const decision = decideDuplicate(
      pair,
      duplicateRequestSchema.parse({ action: 'keep_both', note: 'two separate visits' }),
      canonical,
    );
    expect(decision).toMatchObject({ outcome: 'dismissed', changes: [] });
    expect(decision.subjects).toHaveLength(2);
  });
});

describe('pairedIntakeIds', () => {
  it('names the exported ids the route has to resolve', () => {
    expect(pairedIntakeIds(pair)).toEqual(['INT-8342', 'INT-8344']);
  });

  it('is empty for a payload that carries no pair', () => {
    expect(pairedIntakeIds(item())).toEqual([]);
  });
});
