import { describe, expect, it } from 'vitest';

import { mapConsentAt, wallTimeToInstant } from './consent-at';

describe('wallTimeToInstant (Europe/Amsterdam)', () => {
  it('converts summer and winter wall times to instants', () => {
    expect(wallTimeToInstant('2024-05-06T07:37:00')?.at.toISOString()).toBe(
      '2024-05-06T05:37:00.000Z',
    );
    expect(wallTimeToInstant('2022-12-15T11:31:00')?.at.toISOString()).toBe(
      '2022-12-15T10:31:00.000Z',
    );
  });

  it('takes the earlier instant for the fall-back hour and marks it ambiguous', () => {
    // 2024-10-27 02:30 local happens twice: 00:30Z (CEST) and 01:30Z (CET).
    const result = wallTimeToInstant('2024-10-27T02:30:00');
    expect(result).toEqual({
      at: new Date('2024-10-27T00:30:00.000Z'),
      ambiguous: true,
      nonexistent: false,
    });
    expect(wallTimeToInstant('2024-10-27T01:59:59')?.ambiguous).toBe(false);
    expect(wallTimeToInstant('2024-10-27T03:00:00')?.ambiguous).toBe(false);
  });

  it('takes the instant after the gap for a spring-forward wall time and marks it nonexistent', () => {
    // 2024-03-31 02:30 local does not exist; +01:00 gives 01:30Z, which is 03:30 CEST.
    const result = wallTimeToInstant('2024-03-31T02:30:00');
    expect(result).toEqual({
      at: new Date('2024-03-31T01:30:00.000Z'),
      ambiguous: false,
      nonexistent: true,
    });
  });

  it('returns null for anything but a full zoneless wall time', () => {
    expect(wallTimeToInstant('2024-05-06T07:37:00Z')).toBeNull();
    expect(wallTimeToInstant('2024-05-06 07:37:00')).toBeNull();
    expect(wallTimeToInstant('2024-05-06T07:37')).toBeNull();
    expect(wallTimeToInstant('2024-02-30T07:37:00')).toBeNull();
    expect(wallTimeToInstant('2024-05-06T24:00:00')).toBeNull();
    expect(wallTimeToInstant('')).toBeNull();
  });
});

describe('mapConsentAt', () => {
  it('writes one TIMESTAMP_ZONE_ASSUMED record from the raw string to the ISO instant', () => {
    expect(mapConsentAt('2024-05-06T07:37:00')).toEqual({
      value: new Date('2024-05-06T05:37:00.000Z'),
      records: [
        {
          field: 'at',
          from: '2024-05-06T07:37:00',
          to: '2024-05-06T05:37:00.000Z',
          ruleCode: 'TIMESTAMP_ZONE_ASSUMED',
          detail: { zone: 'Europe/Amsterdam' },
        },
      ],
      flags: [],
    });
  });
  it('records ambiguity in the detail', () => {
    expect(mapConsentAt('2024-10-27T02:30:00').records[0]?.detail).toEqual({
      zone: 'Europe/Amsterdam',
      ambiguous: true,
    });
  });
  it('flags an unparsable value and writes no record', () => {
    expect(mapConsentAt('yesterday')).toEqual({
      value: null,
      records: [],
      flags: [{ kind: 'timestamp_unparsed', field: 'at', raw: 'yesterday' }],
    });
  });
});
