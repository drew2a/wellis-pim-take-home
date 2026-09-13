// Pure: what a reviewer records about a consent item. Never a consent event (`CLAUDE.md` §5).
import { describe, expect, it } from 'vitest';

import { consentRequestSchema, decideConsent } from './consent';
import { DecisionError } from './types';

const PATIENT = '11111111-1111-4111-8111-111111111111';
/** The patient `PATIENT` was merged into after the item was raised (ADR-0008 item 2). */
const SURVIVOR = '22222222-2222-4222-8222-222222222222';

type Item = Parameters<typeof decideConsent>[0];

const item = (patientId: string | null = PATIENT, field: string | null = 'data_processing'): Item =>
  ({ id: 'item-1', patientId, field }) as Item;

const request = (
  action: string,
  note = 'patient contacted; consent re-obtained on paper',
  extra: Record<string, unknown> = {},
) => consentRequestSchema.parse({ action, note, ...extra });

describe('recording what was done', () => {
  it('closes the item against the patient and changes no value', () => {
    const { decision, establish } = decideConsent(item(), request('resolve'), 'revoked', PATIENT);
    expect(decision).toMatchObject({ outcome: 'resolved', changes: [] });
    expect(decision.subjects).toEqual([{ entityType: 'patient', entityId: PATIENT }]);
    expect(establish).toBeNull();
  });

  it('dismisses when there is nothing to do', () => {
    expect(decideConsent(item(), request('dismiss'), 'revoked', PATIENT).decision).toMatchObject({
      outcome: 'dismissed',
    });
  });

  it('needs a note on every answer', () => {
    expect(() => request('resolve', '   ')).toThrow();
    expect(() => request('dismiss', '')).toThrow();
    expect(() => request('set_state', ' ', { state: 'granted' })).toThrow();
  });

  it('refuses an item that names no patient', () => {
    expect(() => decideConsent(item(null), request('resolve'), 'revoked', null)).toThrow(
      DecisionError,
    );
  });
});

// The seven logs that contradict themselves: a revocation before any grant, where no rule can say
// what is true and a person has to find out (ADR-0025).
describe('establishing a state over a log that contradicts itself', () => {
  const setState = (state: string) =>
    request('set_state', 'reached the patient; consent given on paper on 2026-09-11', { state });

  it('records the decision as a change against the patient, and the state to write', () => {
    const { decision, establish } = decideConsent(item(), setState('granted'), 'conflict', PATIENT);
    expect(decision.subjects?.[0]?.changes).toEqual([
      { field: 'consent_state:data_processing', from: 'conflict', to: 'granted' },
    ]);
    expect(establish).toEqual({ patientId: PATIENT, type: 'data_processing', state: 'granted' });
    expect(decision.resolution).toMatchObject({ state: 'granted', was: 'conflict' });
  });

  it('writes no field on the patient: a consent state is not a column a reviewer types', () => {
    expect(
      decideConsent(item(), setState('revoked'), 'conflict', PATIENT).decision.changes,
    ).toEqual([]);
  });

  // A revocation that is unambiguous is acted on, not overridden (ADR-0025 §3).
  it.each(['granted', 'revoked', 'no_record', 'unknown_pre_log', null])(
    'refuses to establish a state over a derived %s',
    (derived) => {
      expect(() => decideConsent(item(), setState('granted'), derived, PATIENT)).toThrow(
        /only a consent state of conflict/,
      );
    },
  );

  it('accepts only granted or revoked', () => {
    expect(() => request('set_state', 'x', { state: 'conflict' })).toThrow();
    expect(() => request('set_state', 'x', { state: 'no_record' })).toThrow();
  });

  // The state lives on the surviving record, and `derived` was read from there: writing the
  // decision at `item.patient_id` would leave the survivor's conflict standing and put the row
  // where the next recomputation deletes it.
  it('establishes the state on the survivor when the item names a record merged away since', () => {
    const { decision, establish } = decideConsent(
      item(),
      setState('granted'),
      'conflict',
      SURVIVOR,
    );
    expect(establish?.patientId).toBe(SURVIVOR);
    expect(decision.subjects?.[0]?.entityId).toBe(SURVIVOR);
  });

  it('refuses an item that names no consent type', () => {
    expect(() =>
      decideConsent(item(PATIENT, null), setState('granted'), 'conflict', PATIENT),
    ).toThrow(/consent type/);
  });
});
