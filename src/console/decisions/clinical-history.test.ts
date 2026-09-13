// Pure: what a reviewer records about a clinical-history item. The outcome never changes.
import { describe, expect, it } from 'vitest';

import { clinicalHistoryRequestSchema, decideClinicalHistory } from './clinical-history';
import { DecisionError } from './types';

const INTAKE = '22222222-2222-4222-8222-222222222222';

type Item = Parameters<typeof decideClinicalHistory>[0];

const item = (intakeId: string | null = INTAKE): Item => ({ id: 'item-1', intakeId }) as Item;

const request = (action: string, note = 'patient contacted; care plan adjusted') =>
  clinicalHistoryRequestSchema.parse({ action, note });

describe('working a clinical-history item', () => {
  it('records the decision against the intake and changes nothing', () => {
    const decision = decideClinicalHistory(item(), request('resolve'));
    expect(decision).toMatchObject({ outcome: 'resolved', changes: [] });
    expect(decision.subjects).toEqual([{ entityType: 'intake', entityId: INTAKE }]);
  });

  it('dismisses when no action is needed', () => {
    expect(decideClinicalHistory(item(), request('dismiss'))).toMatchObject({
      outcome: 'dismissed',
    });
  });

  it('needs a note on either answer', () => {
    expect(() => request('resolve', ' ')).toThrow();
    expect(() => request('dismiss', '')).toThrow();
  });

  // There is no action that revisits the legacy outcome, here or in the schema.
  it('has no way to change the outcome', () => {
    expect(() =>
      clinicalHistoryRequestSchema.parse({ action: 'reject_retroactively', note: 'x' }),
    ).toThrow();
  });

  it('refuses an item that names no intake', () => {
    expect(() => decideClinicalHistory(item(null), request('resolve'))).toThrow(DecisionError);
  });
});
