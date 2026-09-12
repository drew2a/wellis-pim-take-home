// Age is the one input the engine does not compute: the caller measures it at the ruleset's
// reference date (submitted_at, Q4) and the rule sees a number (ADR-0010).
import { describe, expect, it } from 'vitest';

import { ageInYears } from './age';

describe('ageInYears', () => {
  it('counts birthdays, boundary on the day itself', () => {
    expect(ageInYears('2008-09-08', '2026-09-08')).toBe(18);
    expect(ageInYears('2008-09-09', '2026-09-08')).toBe(17);
    expect(ageInYears('1923-01-01', '2026-06-01')).toBe(103);
  });

  it('turns 18 on the birthday, not the day before', () => {
    // 17 years 364 days, then 18 years 0 days.
    expect(ageInYears('2008-03-01', '2026-02-28')).toBe(17);
    expect(ageInYears('2008-03-01', '2026-03-01')).toBe(18);
  });

  it('makes a 29 February birthday an adult on 1 March of a non-leap year', () => {
    expect(ageInYears('2008-02-29', '2026-02-28')).toBe(17);
    expect(ageInYears('2008-02-29', '2026-03-01')).toBe(18);
    // ... and on the day itself when the reference year has one.
    expect(ageInYears('2008-02-29', '2028-02-29')).toBe(20);
  });
});
