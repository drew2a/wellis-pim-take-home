// The date-of-birth bounds the form offers (ADR-0015 item 2).
//
// The contract under test is not "these are the right strings" but "the field and the server agree":
// every day the input offers is a day `identitySchema` accepts, and the day just outside each bound
// is one it refuses. Written this way, the test fails if either side moves.
import { describe, expect, it } from 'vitest';

import { MAX_PLAUSIBLE_AGE_YEARS } from '@/eligibility/age';
import { currentRules } from '@/rules/load';

import { INTAKE_STEPS, dobBounds, stepSchemas } from './answers';

const accepts = (todayIso: string, dob: string): boolean =>
  stepSchemas({ rules: currentRules(), todayIso }).identity.safeParse({
    fullName: 'Sem de Boer',
    email: 'sem@example.com',
    dob,
  }).success;

const shift = (iso: string, days: number): string => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

// An ordinary day, a leap day, and the first of a month, so the arithmetic is exercised where it
// is most likely to be wrong.
const DAYS = ['2026-09-13', '2024-02-29', '2026-03-01', '2026-01-01'];

describe('dobBounds', () => {
  it.each(DAYS)('offers only days the server accepts, on %s', (today) => {
    const { min, max } = dobBounds(today);

    expect(accepts(today, min)).toBe(true);
    expect(accepts(today, max)).toBe(true);
  });

  it.each(DAYS)('stops one day short of what the server refuses, on %s', (today) => {
    const { min, max } = dobBounds(today);

    // Older than the bound is an implausible age; later than the bound is not in the past.
    expect(accepts(today, shift(min, -1))).toBe(false);
    expect(accepts(today, shift(max, 1))).toBe(false);
  });

  it('puts the late bound on the day before today, because a birth today is not in the past', () => {
    expect(dobBounds('2026-09-13').max).toBe('2026-09-12');
    expect(dobBounds('2026-01-01').max).toBe('2025-12-31');
  });

  it('puts the early bound on the oldest accepted birthday, so the year can never be six digits', () => {
    // The day after the 101st birthday: someone born on it is still 100 today, and one day
    // earlier is the first date the schema calls implausible.
    expect(dobBounds('2026-09-13').min).toBe(`${2026 - MAX_PLAUSIBLE_AGE_YEARS - 1}-09-14`);
  });

  it('keeps a leap-day bound on a real calendar day', () => {
    // 1923 and 1899 are not leap years, so the shift lands on 28 February rather than rolling
    // forward to 1 March, which would cut a day off the range the schema allows.
    expect(dobBounds('2024-02-29').min).toBe('1923-03-01');
    expect(dobBounds('2000-02-29').min).toBe('1899-03-01');
  });
});

// ADR-0019: consent is step one, and `POST /api/intakes` names that step explicitly. The route and
// this list are the two places the order is written down; this is what keeps them from drifting.
describe('the order of the steps', () => {
  it('asks for consent before anything else, so no health data is sent without permission', () => {
    expect(INTAKE_STEPS[0]).toBe('consent');
  });

  it('leaves consent out of the rest, so it is asked exactly once', () => {
    expect(INTAKE_STEPS.slice(1)).not.toContain('consent');
  });
});
