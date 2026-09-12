// The consent derivation of ADR-0005, as its Confirmation section asks for it: out-of-order
// events, equal timestamps, revoke-first pairs, and no events with a signup date either side of
// the log's first year. The log is evidence; the state is what we act on (`CLAUDE.md` §6).
import { describe, expect, it } from 'vitest';

import { deriveConsentStates, type ConsentEventInput } from './derive';

const TYPE = 'data_processing';
const TYPES = [TYPE];

const event = (
  id: string,
  action: 'granted' | 'revoked',
  at: string,
  type: string = TYPE,
): ConsentEventInput => ({ id, type, action, at: new Date(at) });

const derive = (
  events: readonly ConsentEventInput[],
  signupDate: string | null = '2024-01-01',
  declaredTypes: readonly string[] = TYPES,
) => deriveConsentStates({ events, signupDate, declaredTypes });

describe('deriveConsentStates (ADR-0005)', () => {
  it('takes the last event by time, whatever order the events arrive in', () => {
    const events = [
      event('c', 'granted', '2024-06-01T10:00:00Z'),
      event('a', 'granted', '2024-01-01T10:00:00Z'),
      event('b', 'revoked', '2024-03-01T10:00:00Z'),
    ];

    expect(derive(events)).toEqual([{ type: TYPE, state: 'granted', derivedFromEventId: 'c' }]);
  });

  it('resolves a grant and a revocation at the same timestamp to revoked', () => {
    const events = [
      event('grant', 'granted', '2024-03-01T10:00:00Z'),
      event('revoke', 'revoked', '2024-03-01T10:00:00Z'),
    ];

    expect(derive(events)).toEqual([
      { type: TYPE, state: 'revoked', derivedFromEventId: 'revoke' },
    ]);
    // Order of arrival must not change the answer.
    expect(derive([...events].reverse())).toEqual([
      { type: TYPE, state: 'revoked', derivedFromEventId: 'revoke' },
    ]);
  });

  // ADR-0011 item 15: the rule is "the first event is a revocation", not "before signup". A
  // revocation that precedes every grant revokes something that was never granted, whatever the
  // signup date says, and only this reading reproduces ADR-0005's count of 7.
  describe('a revocation before the first grant', () => {
    it('is a conflict, and names the revocation as the event to look at', () => {
      const events = [
        event('revoke', 'revoked', '2023-05-01T10:00:00Z'),
        event('grant', 'granted', '2024-06-01T10:00:00Z'),
      ];

      expect(derive(events, '2024-01-01')).toEqual([
        { type: TYPE, state: 'conflict', derivedFromEventId: 'revoke' },
      ]);
    });

    it('is a conflict even when no grant ever followed it', () => {
      const events = [event('revoke', 'revoked', '2023-05-01T10:00:00Z')];

      expect(derive(events, '2024-01-01')[0]?.state).toBe('conflict');
    });

    // The seventh conflict in this export: recrji0nd3KzVGPAJ revoked the day after signing up
    // and was granted eight days later.
    it('is a conflict when the revocation follows the signup', () => {
      const events = [
        event('revoke', 'revoked', '2024-05-01T10:00:00Z'),
        event('grant', 'granted', '2024-06-01T10:00:00Z'),
      ];

      expect(derive(events, '2024-01-01')[0]?.state).toBe('conflict');
    });

    it('is a conflict without a signup date to compare against', () => {
      const events = [event('revoke', 'revoked', '2023-05-01T10:00:00Z')];

      expect(derive(events, null)[0]?.state).toBe('conflict');
    });

    it('is not raised when a grant came first', () => {
      const events = [
        event('grant', 'granted', '2024-02-01T10:00:00Z'),
        event('revoke', 'revoked', '2024-05-01T10:00:00Z'),
      ];

      expect(derive(events, '2024-01-01')[0]?.state).toBe('revoked');
    });
  });

  describe('a patient with no event at all', () => {
    it.each([
      ['2022-12-31', 'unknown_pre_log'],
      ['2023-01-01', 'no_record'],
      ['2024-06-01', 'no_record'],
    ])('signed up on %s is %s', (signupDate, state) => {
      expect(derive([], signupDate)).toEqual([{ type: TYPE, state, derivedFromEventId: null }]);
    });

    // ADR-0011 item 6: the 3 patients dated 2062 have no signup date, so they cannot be placed
    // either side of the cut-over; the log's coverage is unknowable for them.
    it('with no signup date is unknown_pre_log', () => {
      expect(derive([], null)).toEqual([
        { type: TYPE, state: 'unknown_pre_log', derivedFromEventId: null },
      ]);
    });
  });

  it('leaves a future-dated revocation winning: revocation is the safe direction', () => {
    const events = [
      event('grant', 'granted', '2024-01-01T10:00:00Z'),
      event('revoke', 'revoked', '2031-01-01T10:00:00Z'),
    ];

    expect(derive(events)[0]?.state).toBe('revoked');
  });

  describe('types', () => {
    it('derives one state per type and never folds a new type into another', () => {
      const events = [
        event('a', 'granted', '2024-01-01T10:00:00Z'),
        event('b', 'granted', '2024-02-01T10:00:00Z', 'marketing'),
        event('c', 'revoked', '2024-03-01T10:00:00Z', 'marketing'),
      ];

      expect(derive(events)).toEqual([
        { type: TYPE, state: 'granted', derivedFromEventId: 'a' },
        { type: 'marketing', state: 'revoked', derivedFromEventId: 'c' },
      ]);
    });

    it('gives a declared type with no event the same no-record state as a patient with none', () => {
      const events = [event('b', 'granted', '2024-02-01T10:00:00Z', 'marketing')];

      expect(derive(events, '2024-01-01')).toEqual([
        { type: TYPE, state: 'no_record', derivedFromEventId: null },
        { type: 'marketing', state: 'granted', derivedFromEventId: 'b' },
      ]);
    });
  });
});
