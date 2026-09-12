// BSN (findings): stored exactly as exported, never normalised; the elfproef result is a
// separate flag column. An identifier, not a quantity: the schema's CHECK wants nine digits, so
// anything else cannot be stored and is blanked with a flag (zero rows in this export).
import { mapped, unchanged, type Mapped } from './types';

export type BsnCheck = 'valid' | 'invalid' | 'absent';

export interface MappedBsn {
  readonly bsn: string | null;
  readonly bsnCheck: BsnCheck;
}

const NINE_DIGITS = /^[0-9]{9}$/u;
const WEIGHTS = [9, 8, 7, 6, 5, 4, 3, 2, -1] as const;

/** The Dutch elfproef: weighted digit sum divisible by 11 (data-profile P-6). */
export function elfproef(bsn: string): boolean {
  if (!NINE_DIGITS.test(bsn)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    sum += Number(bsn[i]) * WEIGHTS[i as 0];
  }
  return sum % 11 === 0;
}

export function mapBsn(raw: string): Mapped<MappedBsn> {
  if (raw === '') {
    return unchanged({ bsn: null, bsnCheck: 'absent' });
  }
  if (!NINE_DIGITS.test(raw)) {
    return mapped(
      { bsn: null, bsnCheck: 'absent' },
      [{ field: 'bsn', from: raw, to: null, ruleCode: 'BSN_MALFORMED_TO_NULL' }],
      [{ kind: 'bsn_malformed', field: 'bsn', raw }],
    );
  }
  if (elfproef(raw)) {
    return unchanged({ bsn: raw, bsnCheck: 'valid' });
  }
  return mapped(
    { bsn: raw, bsnCheck: 'invalid' },
    [],
    [{ kind: 'bsn_invalid', field: 'bsn', raw }],
  );
}
