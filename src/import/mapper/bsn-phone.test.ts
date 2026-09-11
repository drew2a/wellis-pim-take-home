import { describe, expect, it } from 'vitest';

import { elfproef, mapBsn } from './bsn';
import { mapPhone } from './phone';

describe('elfproef', () => {
  it('passes a valid number and fails a one-digit change', () => {
    // 251508596 is the first bsn in the export (data-profile P-6, 924 of 941 pass).
    expect(elfproef('251508596')).toBe(true);
    expect(elfproef('251508597')).toBe(false);
  });
  it('fails eight digits, letters and empty', () => {
    expect(elfproef('25150859')).toBe(false);
    expect(elfproef('25150859a')).toBe(false);
    expect(elfproef('')).toBe(false);
  });
});

describe('mapBsn', () => {
  it('stores empty as absent with no record and no flag', () => {
    expect(mapBsn('')).toEqual({
      value: { bsn: null, bsnCheck: 'absent' },
      records: [],
      flags: [],
    });
  });
  it('stores a valid number unchanged as valid', () => {
    expect(mapBsn('251508596')).toEqual({
      value: { bsn: '251508596', bsnCheck: 'valid' },
      records: [],
      flags: [],
    });
  });
  it('stores a failing number unchanged as invalid with a flag and no record', () => {
    expect(mapBsn('251508597')).toEqual({
      value: { bsn: '251508597', bsnCheck: 'invalid' },
      records: [],
      flags: [{ kind: 'bsn_invalid', field: 'bsn', raw: '251508597' }],
    });
  });
  it('blanks a malformed value the CHECK could not store, with a record and a flag', () => {
    expect(mapBsn('12345678')).toEqual({
      value: { bsn: null, bsnCheck: 'absent' },
      records: [{ field: 'bsn', from: '12345678', to: null, ruleCode: 'BSN_MALFORMED_TO_NULL' }],
      flags: [{ kind: 'bsn_malformed', field: 'bsn', raw: '12345678' }],
    });
  });
});

describe('mapPhone', () => {
  it('keeps +316 numbers unchanged', () => {
    expect(mapPhone('+31608913757')).toEqual({ value: '+31608913757', records: [], flags: [] });
  });
  it.each([
    ['06-53549409', '+31653549409'],
    ['0669708184', '+31669708184'],
  ])('converts %s to %s under PHONE_E164_NL_MOBILE', (raw, e164) => {
    expect(mapPhone(raw)).toEqual({
      value: e164,
      records: [{ field: 'phone', from: raw, to: e164, ruleCode: 'PHONE_E164_NL_MOBILE' }],
      flags: [],
    });
  });
  it('stores empty as null with no record', () => {
    expect(mapPhone('')).toEqual({ value: null, records: [], flags: [] });
  });
  it('blanks an unseen form with a proposal when the digits are obvious', () => {
    const result = mapPhone('0031 6 12345678');
    expect(result.value).toBeNull();
    expect(result.records).toEqual([
      { field: 'phone', from: '0031 6 12345678', to: null, ruleCode: 'PHONE_UNPARSED_TO_NULL' },
    ]);
    expect(result.flags).toEqual([
      { kind: 'phone_unparsed', field: 'phone', raw: '0031 6 12345678', proposed: '+31612345678' },
    ]);
    expect(mapPhone('+31 6 12345678').flags[0]).toMatchObject({ proposed: '+31612345678' });
  });
  it('blanks an unseen form without a proposal when the digits are not a Dutch mobile', () => {
    expect(mapPhone('020-1234567').flags[0]).toMatchObject({ proposed: null });
    expect(mapPhone('+4412345678901').flags[0]).toMatchObject({ proposed: null });
  });
});
