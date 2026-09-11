// Phone (findings): canonical E.164 for Dutch mobiles. The three seen forms are `+316` followed
// by eight digits (stored unchanged), `06-` and eight digits, and `06` and eight digits (both
// converted with PHONE_E164_NL_MOBILE). Any other form is null with a flag; the flag carries a
// proposal only when the digits read unambiguously as a Dutch mobile.
import { mapped, unchanged, type Mapped } from './types';

const E164_NL_MOBILE = /^\+316[0-9]{8}$/u;
const NATIONAL = /^06-?[0-9]{8}$/u;
// For the proposal: any punctuation removed, then a country prefix (+31, 0031, 31) or trunk 0.
const OBVIOUS_DIGITS = /^(?:0031|31|0)(6[0-9]{8})$/u;

export function mapPhone(raw: string): Mapped<string | null> {
  if (raw === '') return unchanged(null);
  if (E164_NL_MOBILE.test(raw)) return unchanged(raw);
  if (NATIONAL.test(raw)) {
    const e164 = `+31${raw.replaceAll('-', '').slice(1)}`;
    return mapped(e164, [
      { field: 'phone', from: raw, to: e164, ruleCode: 'PHONE_E164_NL_MOBILE' },
    ]);
  }
  const digits = raw.replaceAll(/[\s\-().+]/gu, '');
  const obvious = OBVIOUS_DIGITS.exec(digits);
  return mapped(
    null,
    [{ field: 'phone', from: raw, to: null, ruleCode: 'PHONE_UNPARSED_TO_NULL' }],
    [
      {
        kind: 'phone_unparsed',
        field: 'phone',
        raw,
        proposed: obvious ? `+31${obvious[1]}` : null,
      },
    ],
  );
}
