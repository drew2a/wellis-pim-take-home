// Pure: what a reviewer's answer on an identity conflict means, without a database.
import { describe, expect, it } from 'vitest';

import type { ConflictCandidate, ConflictView } from '@/repo/identity';

import { decideIdentity, identityRequestSchema } from './identity';
import { DecisionError } from './types';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ELSEWHERE = '33333333-3333-4333-8333-333333333333';

const candidate = (patientId: string, mergedInto: string | null = null): ConflictCandidate => ({
  patientId,
  legacyIds: [],
  fields: {} as ConflictCandidate['fields'],
  intakeCount: 0,
  consentStates: {},
  mergedInto,
});

const view = (...candidates: ConflictCandidate[]): ConflictView => ({
  candidates,
  matchedKeys: ['bsn'],
  contradictions: ['dob'],
  tier: 3,
  differing: ['dob'],
});

const merge = (overrides: Record<string, unknown> = {}) =>
  identityRequestSchema.parse({
    action: 'merge',
    note: 'same person, confirmed by phone',
    survivorId: A,
    loserId: B,
    ...overrides,
  });

describe('the request an identity item accepts', () => {
  it('needs a note on either answer', () => {
    expect(() => merge({ note: ' ' })).toThrow();
    expect(() =>
      identityRequestSchema.parse({ action: 'not_the_same_person', note: '' }),
    ).toThrow();
  });

  it('refuses a field that is not the person’s', () => {
    expect(() => merge({ decisions: { merged_into: { source: 'edited', value: A } } })).toThrow();
  });

  // The screen shows a masked bsn; a request that carried a value with a row pick could write it.
  it('refuses a value alongside a row pick', () => {
    expect(() => merge({ decisions: { bsn: { source: 'loser', value: '******333' } } })).toThrow();
  });

  // `source` and `signup_date` describe the row, not the person, and the survivor keeps its own.
  it('refuses a decision about a row-provenance field', () => {
    expect(() => merge({ decisions: { source: { source: 'loser' } } })).toThrow();
  });

  it('refuses an action it does not have', () => {
    expect(() => identityRequestSchema.parse({ action: 'delete', note: 'x' })).toThrow();
  });
});

describe('merging', () => {
  it('translates the screen’s column names into the merge’s fields', () => {
    const decision = decideIdentity(
      view(candidate(A), candidate(B)),
      merge({
        decisions: {
          full_name: { source: 'loser' },
          weight_kg: { source: 'edited', value: '72.6' },
        },
      }),
    );
    expect(decision).toMatchObject({
      kind: 'merge',
      survivorId: A,
      loserId: B,
      fieldDecisions: {
        fullName: { source: 'loser' },
        weightKg: { source: 'edited', value: '72.6' },
      },
    });
  });

  it('records which fields were decided', () => {
    const decision = decideIdentity(
      view(candidate(A), candidate(B)),
      merge({ decisions: { dob: { source: 'loser' } } }),
    );
    expect(decision.resolution).toMatchObject({ action: 'merge', decided: ['dob'] });
  });

  // A uuid in a request must never be able to merge two patients that were never compared.
  it('refuses a record this item does not compare', () => {
    expect(() =>
      decideIdentity(view(candidate(A), candidate(B)), merge({ loserId: ELSEWHERE })),
    ).toThrow(DecisionError);
  });

  it('refuses a record merged into itself', () => {
    expect(() => decideIdentity(view(candidate(A), candidate(B)), merge({ loserId: A }))).toThrow(
      /into itself/,
    );
  });

  // Two reviewers with the same item open, and one of them was quicker.
  it('refuses a loser that has already been merged away', () => {
    expect(() => decideIdentity(view(candidate(A), candidate(B, A)), merge())).toThrow(/reload/);
  });
});

describe('deciding they are two people', () => {
  it('dismisses, writes no merge, and names the records it separated', () => {
    const decision = decideIdentity(
      view(candidate(A), candidate(B)),
      identityRequestSchema.parse({
        action: 'not_the_same_person',
        note: 'a shared household phone; different dates of birth',
      }),
    );
    expect(decision).toMatchObject({ kind: 'dismiss' });
    expect(decision.resolution).toMatchObject({ candidates: [A, B] });
  });
});
