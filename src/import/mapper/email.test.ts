import { describe, expect, it } from 'vitest';

import { mapEmail } from './email';
import { trimWhitespace } from './text';

describe('trimWhitespace', () => {
  it('records the trim and leaves clean values alone', () => {
    expect(trimWhitespace('Jan Jansen', 'full_name')).toEqual({
      value: 'Jan Jansen',
      records: [],
      flags: [],
    });
    expect(trimWhitespace('Jan Jansen  ', 'full_name').records).toEqual([
      { field: 'full_name', from: 'Jan Jansen  ', to: 'Jan Jansen', ruleCode: 'WHITESPACE_TRIM' },
    ]);
  });
});

describe('mapEmail', () => {
  it('keeps a clean address with no record', () => {
    expect(mapEmail('zeynep.chen@live.nl')).toEqual({
      value: 'zeynep.chen@live.nl',
      records: [],
      flags: [],
    });
  });

  it('chains WHITESPACE_TRIM then EMAIL_LOWERCASE, each from the previous value', () => {
    const result = mapEmail(' PRIYA.IVANOV@ZIGGO.NL  ');
    expect(result.value).toBe('priya.ivanov@ziggo.nl');
    expect(result.records.map((r) => [r.ruleCode, r.from, r.to])).toEqual([
      ['WHITESPACE_TRIM', ' PRIYA.IVANOV@ZIGGO.NL  ', 'PRIYA.IVANOV@ZIGGO.NL'],
      ['EMAIL_LOWERCASE', 'PRIYA.IVANOV@ZIGGO.NL', 'priya.ivanov@ziggo.nl'],
    ]);
    expect(result.flags).toEqual([]);
  });

  // ADR-0009 item 1: empty raw is empty, but a whitespace-only value is not empty raw, so the
  // null it becomes needs a record chain that ends at null and a flag so a human sees it.
  it('chains the trim into EMAIL_PLACEHOLDER_TO_NULL for a whitespace-only value', () => {
    const result = mapEmail('   ');
    expect(result.value).toBeNull();
    expect(result.records.map((r) => [r.ruleCode, r.from, r.to])).toEqual([
      ['WHITESPACE_TRIM', '   ', ''],
      ['EMAIL_PLACEHOLDER_TO_NULL', '', null],
    ]);
    expect(result.flags).toEqual([{ kind: 'email_placeholder', field: 'email', raw: '   ' }]);
  });

  it('keeps an empty raw value null with no record (ADR-0009 item 1, empty is empty)', () => {
    expect(mapEmail('')).toEqual({ value: null, records: [], flags: [] });
  });

  it.each(['n.v.t.', 'x', '-', 'none', 'info@', '@gmail.com'])(
    'blanks the placeholder %s with no proposal',
    (raw) => {
      const result = mapEmail(raw);
      expect(result.value).toBeNull();
      expect(result.records).toEqual([
        { field: 'email', from: raw, to: null, ruleCode: 'EMAIL_PLACEHOLDER_TO_NULL' },
      ]);
      expect(result.flags).toEqual([{ kind: 'email_placeholder', field: 'email', raw }]);
    },
  );

  it('blanks an address with an internal space and proposes the address without it', () => {
    const result = mapEmail('willem.ricci @icloud.com');
    expect(result.value).toBeNull();
    expect(result.records).toEqual([
      {
        field: 'email',
        from: 'willem.ricci @icloud.com',
        to: null,
        ruleCode: 'EMAIL_INTERNAL_SPACE_TO_NULL',
      },
    ]);
    expect(result.flags).toEqual([
      {
        kind: 'email_internal_space',
        field: 'email',
        raw: 'willem.ricci @icloud.com',
        proposed: 'willem.ricci@icloud.com',
      },
    ]);
  });

  it('stores empty as null with no record', () => {
    expect(mapEmail('')).toEqual({ value: null, records: [], flags: [] });
  });
});
