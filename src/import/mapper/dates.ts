// Dates under the separator convention (ADR-0005, H-1): `9999-99-99` is Y-M-D, `99-99-9999` is
// D-M-Y, `99/99/9999` is M-D-Y. Anything else is unreadable and stored null with a flag, never
// guessed. "Impossible" is relative to the run's --as-of date (ADR-0009).
import { ageInYears, MAX_PLAUSIBLE_AGE_YEARS } from '@/eligibility/age';

import { mapped, unchanged, type Flag, type Mapped, type RecordDraft } from './types';

export type DateShape = 'iso' | 'dash' | 'slash';

export interface ReadDate {
  readonly iso: string;
  readonly shape: DateShape;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/u;
const DASH = /^(\d{2})-(\d{2})-(\d{4})$/u;
const SLASH = /^(\d{2})\/(\d{2})\/(\d{4})$/u;

function isoIfValid(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** The value read under the convention, or null when its shape is not one of the three. */
export function readDateBySeparator(raw: string): ReadDate | null {
  let m = ISO.exec(raw);
  if (m) {
    const iso = isoIfValid(Number(m[1]), Number(m[2]), Number(m[3]));
    return iso === null ? null : { iso, shape: 'iso' };
  }
  m = DASH.exec(raw);
  if (m) {
    const iso = isoIfValid(Number(m[3]), Number(m[2]), Number(m[1]));
    return iso === null ? null : { iso, shape: 'dash' };
  }
  m = SLASH.exec(raw);
  if (m) {
    const iso = isoIfValid(Number(m[3]), Number(m[1]), Number(m[2]));
    return iso === null ? null : { iso, shape: 'slash' };
  }
  return null;
}

/**
 * The date the value would be if its two non-year parts were read the other way round (Y-D-M for
 * ISO, M-D-Y for dash, D-M-Y for slash), when that is a valid calendar date different from the
 * reading (data-profile P-4: 987 values, 921 of them a different date). The review layer uses
 * it for the minor/adult flip check.
 */
export function alternativeReading(raw: string): string | null {
  const read = readDateBySeparator(raw);
  if (read === null) return null;
  const [y, m, d] = read.iso.split('-').map(Number) as [number, number, number];
  const swapped = isoIfValid(y, d, m);
  return swapped === null || swapped === read.iso ? null : swapped;
}

export interface DateContext {
  /** `YYYY-MM-DD`: a date after it cannot have happened (ADR-0009 item 1). */
  readonly asOf: string;
  /** For dob only: the patient's signup date; an age above 100 there is impossible (findings). */
  readonly signupIso?: string | null;
}

const ORDER: Record<DateShape, string> = { iso: 'Y-M-D', dash: 'D-M-Y', slash: 'M-D-Y' };

/**
 * Maps one date column. Records chain: a non-ISO value gets `DATE_ORDER_FROM_SEPARATOR` from the
 * raw string to the read date, and an impossible one then `DATE_IMPOSSIBLE_TO_NULL` from the read
 * date to null, so both facts stand and the ADR-0005 counts hold (ADR-0009 item 1).
 */
export function mapDate(raw: string, field: string, context: DateContext): Mapped<string | null> {
  if (raw === '') return unchanged(null);
  const read = readDateBySeparator(raw);
  if (read === null) {
    return mapped(
      null,
      [{ field, from: raw, to: null, ruleCode: 'DATE_UNREADABLE_TO_NULL' }],
      [{ kind: 'date_unreadable', field, raw }],
    );
  }
  const records: RecordDraft[] = [];
  if (read.shape !== 'iso') {
    records.push({
      field,
      from: raw,
      to: read.iso,
      ruleCode: 'DATE_ORDER_FROM_SEPARATOR',
      detail: { order: ORDER[read.shape] },
    });
  }
  const impossible = whyImpossible(read.iso, context);
  if (impossible === null) {
    return mapped(read.iso, records);
  }
  records.push({
    field,
    from: read.iso,
    to: null,
    ruleCode: 'DATE_IMPOSSIBLE_TO_NULL',
    detail: { reason: impossible, asOf: context.asOf },
  });
  const flag: Flag = { kind: 'date_impossible', field, raw, read: read.iso, reason: impossible };
  return mapped(null, records, [flag]);
}

function whyImpossible(
  iso: string,
  context: DateContext,
): 'after_as_of' | 'age_above_100_at_signup' | null {
  if (iso > context.asOf) return 'after_as_of';
  if (
    context.signupIso !== undefined &&
    context.signupIso !== null &&
    ageInYears(iso, context.signupIso) > MAX_PLAUSIBLE_AGE_YEARS
  ) {
    return 'age_above_100_at_signup';
  }
  return null;
}
