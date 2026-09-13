// The clinic's calendar day (ADR-0017).
//
// The cases that matter are the ones where the clinic's day and the UTC day differ, because that
// window is where an age — and therefore an absolute reject — goes wrong.
import { describe, expect, it } from 'vitest';

import { CLINIC_TIME_ZONE, dayOf } from './today';

const utcDay = (iso: string): string => new Date(iso).toISOString().slice(0, 10);

describe('dayOf', () => {
  it.each([
    ['summer, UTC+2', '2026-07-14T22:30:00Z', '2026-07-15'],
    ['winter, UTC+1', '2026-01-14T23:30:00Z', '2026-01-15'],
  ])(
    'gives the clinic day, not the UTC day, just after local midnight (%s)',
    (_name, instant, expected) => {
      expect(dayOf(new Date(instant))).toBe(expected);
      // The bug this replaces: UTC still calls it yesterday.
      expect(utcDay(instant)).not.toBe(expected);
    },
  );

  it.each([
    ['midday', '2026-07-14T12:00:00Z', '2026-07-14'],
    ['just before local midnight, summer', '2026-07-14T21:59:59Z', '2026-07-14'],
    ['just before local midnight, winter', '2026-01-14T22:59:59Z', '2026-01-14'],
  ])('agrees with UTC the rest of the time (%s)', (_name, instant, expected) => {
    expect(dayOf(new Date(instant))).toBe(expected);
  });

  it('crosses the year on the clinic clock', () => {
    expect(dayOf(new Date('2025-12-31T23:30:00Z'))).toBe('2026-01-01');
  });

  it('always produces a zero-padded YYYY-MM-DD', () => {
    expect(dayOf(new Date('2026-01-05T12:00:00Z'))).toBe('2026-01-05');
  });

  it('names the zone it uses, so the decision is readable rather than implied', () => {
    expect(CLINIC_TIME_ZONE).toBe('Europe/Amsterdam');
  });
});
