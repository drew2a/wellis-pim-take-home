import { describe, expect, it } from 'vitest';

import { ageInYears, alternativeReading, mapDate, readDateBySeparator } from './dates';

const ctx = { asOf: '2026-09-08' };

describe('readDateBySeparator (H-1 convention)', () => {
  it('reads the three shapes and nothing else', () => {
    expect(readDateBySeparator('1960-02-03')).toEqual({ iso: '1960-02-03', shape: 'iso' });
    expect(readDateBySeparator('03-02-1960')).toEqual({ iso: '1960-02-03', shape: 'dash' });
    expect(readDateBySeparator('02/03/1960')).toEqual({ iso: '1960-02-03', shape: 'slash' });
    expect(readDateBySeparator('3-2-1960')).toBeNull();
    expect(readDateBySeparator('1960/02/03')).toBeNull();
    expect(readDateBySeparator('03.02.1960')).toBeNull();
    expect(readDateBySeparator('20-02-60')).toBeNull();
  });

  it('maps the duplicate pair `03-02-1960` and `02/03/1960` to the same date', () => {
    expect(readDateBySeparator('03-02-1960')?.iso).toBe(readDateBySeparator('02/03/1960')?.iso);
  });

  it('rejects calendar-invalid values under the convention', () => {
    expect(readDateBySeparator('31-02-2001')).toBeNull();
    expect(readDateBySeparator('13/01/2001')).toBeNull(); // slash is M-D-Y: month 13
    expect(readDateBySeparator('2001-02-29')).toBeNull();
    expect(readDateBySeparator('2000-02-29')).toEqual({ iso: '2000-02-29', shape: 'iso' });
  });
});

describe('alternativeReading', () => {
  it('is the swapped reading when valid and different', () => {
    expect(alternativeReading('03-02-1960')).toBe('1960-03-02');
    expect(alternativeReading('02/03/1960')).toBe('1960-03-02');
  });
  it('is null for ISO, for day = month, and when the swap is not a date', () => {
    expect(alternativeReading('1960-02-03')).toBeNull();
    expect(alternativeReading('03-03-1960')).toBeNull();
    expect(alternativeReading('23-08-2000')).toBeNull();
  });
});

describe('ageInYears', () => {
  it('counts birthdays, boundary on the day itself', () => {
    expect(ageInYears('2008-09-08', '2026-09-08')).toBe(18);
    expect(ageInYears('2008-09-09', '2026-09-08')).toBe(17);
    expect(ageInYears('1923-01-01', '2026-06-01')).toBe(103);
  });
});

describe('mapDate', () => {
  it('stores an ISO value unchanged with no record', () => {
    expect(mapDate('1989-05-28', 'dob', ctx)).toEqual({
      value: '1989-05-28',
      records: [],
      flags: [],
    });
  });

  it('stores empty as null with no record: empty is empty', () => {
    expect(mapDate('', 'submitted_at', ctx)).toEqual({ value: null, records: [], flags: [] });
  });

  it('writes DATE_ORDER_FROM_SEPARATOR for dash and slash values', () => {
    const dash = mapDate('23-08-2000', 'dob', ctx);
    expect(dash.value).toBe('2000-08-23');
    expect(dash.records).toEqual([
      {
        field: 'dob',
        from: '23-08-2000',
        to: '2000-08-23',
        ruleCode: 'DATE_ORDER_FROM_SEPARATOR',
        detail: { order: 'D-M-Y' },
      },
    ]);
    expect(mapDate('02/16/1962', 'dob', ctx).records[0]?.detail).toEqual({ order: 'M-D-Y' });
  });

  it('chains DATE_IMPOSSIBLE_TO_NULL after the order record for a future slash date', () => {
    const result = mapDate('09/13/2060', 'dob', ctx);
    expect(result.value).toBeNull();
    expect(result.records.map((r) => [r.ruleCode, r.from, r.to])).toEqual([
      ['DATE_ORDER_FROM_SEPARATOR', '09/13/2060', '2060-09-13'],
      ['DATE_IMPOSSIBLE_TO_NULL', '2060-09-13', null],
    ]);
    expect(result.flags).toEqual([
      {
        kind: 'date_impossible',
        field: 'dob',
        raw: '09/13/2060',
        read: '2060-09-13',
        reason: 'after_as_of',
      },
    ]);
  });

  it('treats the as-of day itself as possible and the day after as impossible', () => {
    expect(mapDate('2026-09-08', 'signup_date', ctx).value).toBe('2026-09-08');
    expect(mapDate('2026-09-09', 'signup_date', ctx).value).toBeNull();
  });

  it('blanks a dob giving an age above 100 at signup, and only when signup is known', () => {
    const old = mapDate('1920-01-01', 'dob', { ...ctx, signupIso: '2024-01-01' });
    expect(old.value).toBeNull();
    expect(old.flags[0]).toMatchObject({
      kind: 'date_impossible',
      reason: 'age_above_100_at_signup',
    });
    expect(mapDate('1924-01-02', 'dob', { ...ctx, signupIso: '2024-01-01' }).value).toBe(
      '1924-01-02',
    );
    expect(mapDate('1920-01-01', 'dob', { ...ctx, signupIso: null }).value).toBe('1920-01-01');
  });

  it('blanks an unreadable value with DATE_UNREADABLE_TO_NULL and a flag, never a guess', () => {
    const result = mapDate('1960.02.03', 'dob', ctx);
    expect(result.value).toBeNull();
    expect(result.records).toEqual([
      { field: 'dob', from: '1960.02.03', to: null, ruleCode: 'DATE_UNREADABLE_TO_NULL' },
    ]);
    expect(result.flags).toEqual([{ kind: 'date_unreadable', field: 'dob', raw: '1960.02.03' }]);
  });
});
