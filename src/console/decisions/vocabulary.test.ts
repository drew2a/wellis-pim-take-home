// Pure: what a reviewer's click on a vocabulary item means, without a database (`CLAUDE.md` §2).
import { describe, expect, it } from 'vitest';

import { DecisionError } from './types';
import { decideVocabulary, legacyIdsOf, vocabularyRequestSchema } from './vocabulary';

const POUNDS = 'WEIGHT_UNIT_MISSING_TO_NULL';

const item = (payload: unknown): Parameters<typeof decideVocabulary>[0] =>
  ({ id: 'item-1', payload }) as Parameters<typeof decideVocabulary>[0];

const weightsItem = item({
  rows: [
    { legacy_id: 'recA', as_pounds: { weight_kg: '76.3' } },
    { legacy_id: 'recB', as_pounds: { weight_kg: '81.2' } },
    { legacy_id: 'recC', as_pounds: { weight_kg: '64.0' } },
  ],
});

const patients: ReadonlyMap<string, string> = new Map([
  ['recA', 'uuid-a'],
  ['recB', 'uuid-b'],
  ['recC', 'uuid-c'],
]);

const request = (overrides: Partial<{ action: string; note: string; excluded: string[] }> = {}) =>
  vocabularyRequestSchema.parse({ action: 'confirm', note: 'checked the export', ...overrides });

describe('the request a vocabulary item accepts', () => {
  it('needs a note', () => {
    expect(() => vocabularyRequestSchema.parse({ action: 'confirm', note: '  ' })).toThrow();
  });

  it('refuses a field the action does not have, rather than ignoring it', () => {
    expect(() =>
      vocabularyRequestSchema.parse({ action: 'confirm', note: 'ok', changes: [] }),
    ).toThrow();
  });
});

describe('an inference that is only answered', () => {
  it.each(['confirm', 'reject'] as const)(
    'records the answer and writes nothing on %s',
    (action) => {
      const decision = decideVocabulary(
        item({ rows: [] }),
        'DATE_ORDER_FROM_SEPARATOR',
        request({ action }),
        patients,
      );
      expect(decision.changes).toEqual([]);
      expect(decision.outcome).toBe('resolved');
      expect(decision.resolution).toMatchObject({ rule: 'DATE_ORDER_FROM_SEPARATOR', action });
    },
  );

  // Rejecting is a decision, not "no decision": the records identify the rows to remap (ADR-0005).
  it('closes a rejected inference as resolved, not as dismissed', () => {
    expect(
      decideVocabulary(item({}), 'VOCAB_SEX', request({ action: 'reject' }), patients).outcome,
    ).toBe('resolved');
  });

  it('dismisses when the question does not need answering', () => {
    expect(
      decideVocabulary(item({}), 'BSN_RETENTION', request({ action: 'dismiss' }), patients),
    ).toMatchObject({ outcome: 'dismissed', changes: [] });
  });
});

describe('the 18 unit-less weights, where confirming is the write', () => {
  it('writes the pounds reading to every listed row', () => {
    const decision = decideVocabulary(weightsItem, POUNDS, request(), patients);
    expect(decision.changes).toEqual([
      { entityType: 'patient', entityId: 'uuid-a', field: 'weight_kg', value: '76.3' },
      { entityType: 'patient', entityId: 'uuid-b', field: 'weight_kg', value: '81.2' },
      { entityType: 'patient', entityId: 'uuid-c', field: 'weight_kg', value: '64.0' },
    ]);
  });

  it('leaves out the rows the reviewer excluded, and says which', () => {
    const decision = decideVocabulary(
      weightsItem,
      POUNDS,
      request({ excluded: ['recB'] }),
      patients,
    );
    expect(decision.changes.map((change) => change.entityId)).toEqual(['uuid-a', 'uuid-c']);
    expect(decision.resolution).toMatchObject({ applied_to: 2, excluded: ['recB'] });
  });

  it('writes nothing when every row is excluded, and still records the answer', () => {
    const decision = decideVocabulary(
      weightsItem,
      POUNDS,
      request({ excluded: ['recA', 'recB', 'recC'] }),
      patients,
    );
    expect(decision.changes).toEqual([]);
    expect(decision.outcome).toBe('resolved');
  });

  // A screen and an item that have drifted apart would otherwise write rows the reviewer thought
  // they had taken out.
  it('refuses an exclusion that is not one of the item’s rows', () => {
    expect(() =>
      decideVocabulary(weightsItem, POUNDS, request({ excluded: ['recZ'] }), patients),
    ).toThrow(DecisionError);
  });

  it('refuses a row whose exported id has no canonical patient', () => {
    expect(() => decideVocabulary(weightsItem, POUNDS, request(), new Map())).toThrow(
      /no canonical patient/,
    );
  });

  it('writes nothing when the answer is no', () => {
    expect(
      decideVocabulary(weightsItem, POUNDS, request({ action: 'reject' }), patients).changes,
    ).toEqual([]);
  });

  it('names the rows whose patients the route has to look up', () => {
    expect(legacyIdsOf(weightsItem, POUNDS)).toEqual(['recA', 'recB', 'recC']);
    expect(legacyIdsOf(weightsItem, 'DATE_ORDER_FROM_SEPARATOR')).toEqual([]);
  });

  it('refuses an item whose payload does not carry the rows the rule applies to', () => {
    expect(() => decideVocabulary(item({ rows: 'nope' }), POUNDS, request(), patients)).toThrow(
      DecisionError,
    );
  });
});
