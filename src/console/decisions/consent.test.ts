// Pure: what a reviewer records about a consent item. Never a consent event (`CLAUDE.md` §5).
import { describe, expect, it } from 'vitest';

import { consentRequestSchema, decideConsent } from './consent';
import { DecisionError } from './types';

const PATIENT = '11111111-1111-4111-8111-111111111111';

type Item = Parameters<typeof decideConsent>[0];

const item = (patientId: string | null = PATIENT): Item =>
  ({ id: 'item-1', patientId, field: 'data_processing' }) as Item;

const request = (action: string, note = 'patient contacted; consent re-obtained on paper') =>
  consentRequestSchema.parse({ action, note });

describe('recording what was done', () => {
  it('closes the item against the patient and changes no value', () => {
    const decision = decideConsent(item(), request('resolve'));
    expect(decision).toMatchObject({ outcome: 'resolved', changes: [] });
    expect(decision.subjects).toEqual([{ entityType: 'patient', entityId: PATIENT }]);
  });

  it('dismisses when there is nothing to do', () => {
    expect(decideConsent(item(), request('dismiss'))).toMatchObject({ outcome: 'dismissed' });
  });

  it('needs a note on either answer', () => {
    expect(() => request('resolve', '   ')).toThrow();
    expect(() => request('dismiss', '')).toThrow();
  });

  // The state is derived from the log; setting it by hand waits on ADR-0025.
  it('has no action that sets the consent state', () => {
    expect(() =>
      consentRequestSchema.parse({ action: 'set_state', note: 'x', state: 'granted' }),
    ).toThrow();
  });

  it('refuses an item that names no patient', () => {
    expect(() => decideConsent(item(null), request('resolve'))).toThrow(DecisionError);
  });
});
