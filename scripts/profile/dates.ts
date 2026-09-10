/**
 * Date reading that refuses to pick an ordering.
 *
 * Why: EXPORT-NOTES.md says at least one automation wrote US-style dates and nobody
 * remembers when. So this module classifies each value by what it *proves* (a part > 12
 * pins that part to the day, or to the month) and enumerates every plausible reading
 * instead of committing to one. No mapping decision is taken here.
 */

export type OrderClass = 'day-first' | 'month-first' | 'ambiguous' | 'invalid' | 'not-three-parts';

export interface DateParts {
  /** Runs of digits, in the order they appear. */
  readonly nums: readonly number[];
  readonly widths: readonly number[];
}

export function splitDateParts(raw: string): DateParts {
  const groups = raw.trim().match(/\d+/gu) ?? [];
  return { nums: groups.map((g) => Number(g)), widths: groups.map((g) => g.length) };
}

/** Position of the year among the first three numeric runs, under the rules below. */
export type YearPosition = 'first' | 'last' | 'assumed-last' | 'unknown';

export function yearPosition(p: DateParts): YearPosition {
  if (p.nums.length < 3) return 'unknown';
  if (p.widths[0] === 4) return 'first';
  if (p.widths[2] === 4) return 'last';
  if (p.widths[0] === 2 && p.widths[1] === 2 && p.widths[2] === 2) return 'assumed-last';
  return 'unknown';
}

/**
 * Classifies the two non-year parts, in the order they appear.
 * `day-first` means the first of the pair must be the day (it is > 12); `month-first`
 * means the second of the pair must be the day. For year-first values the pair is the
 * two trailing parts, so `day-first` there means YYYY-DD-MM.
 */
export function classifyOrder(raw: string): OrderClass {
  const p = splitDateParts(raw);
  if (p.nums.length < 3) return 'not-three-parts';
  const yp = yearPosition(p);
  if (yp === 'unknown') return 'invalid';
  const pair =
    yp === 'first'
      ? [p.nums[1] as number, p.nums[2] as number]
      : [p.nums[0] as number, p.nums[1] as number];
  const [a, b] = pair as [number, number];
  if (a === 0 || b === 0 || a > 31 || b > 31) return 'invalid';
  if (a > 12 && b > 12) return 'invalid';
  if (a > 12) return 'day-first';
  if (b > 12) return 'month-first';
  return 'ambiguous';
}

/** Two-digit year pivot: 00..26 -> 2000s, 27..99 -> 1900s. Stated in the profile. */
export const TWO_DIGIT_YEAR_PIVOT = 26;

function expandYear(y: number, width: number): number {
  if (width === 4) return y;
  return y <= TWO_DIGIT_YEAR_PIVOT ? 2000 + y : 1900 + y;
}

function isoIfValid(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1 || y > 9999) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Every calendar-valid reading of the value, under these plausible orderings only:
 * year-first (4-digit leading part): Y-M-D and Y-D-M;
 * year-last (4-digit trailing part): D-M-Y and M-D-Y;
 * all parts two digits: D-M-Y, M-D-Y and Y-M-D, with the pivot above.
 */
export function candidateDates(raw: string): string[] {
  const p = splitDateParts(raw);
  if (p.nums.length < 3) return [];
  const [n0, n1, n2] = [p.nums[0] as number, p.nums[1] as number, p.nums[2] as number];
  const [w0, w1, w2] = [p.widths[0] as number, p.widths[1] as number, p.widths[2] as number];
  const out = new Set<string>();
  const push = (iso: string | null): void => {
    if (iso !== null) out.add(iso);
  };
  if (w0 === 4) {
    push(isoIfValid(n0, n1, n2));
    push(isoIfValid(n0, n2, n1));
  } else if (w2 === 4) {
    push(isoIfValid(n2, n1, n0));
    push(isoIfValid(n2, n0, n1));
  } else if (w0 === 2 && w1 === 2 && w2 === 2) {
    push(isoIfValid(expandYear(n2, w2), n1, n0));
    push(isoIfValid(expandYear(n2, w2), n0, n1));
    push(isoIfValid(expandYear(n0, w0), n1, n2));
  }
  return [...out].sort();
}

/** The 4-digit year run if there is one, else the expanded 2-digit year, else `''`. */
export function yearLabel(raw: string): string {
  const p = splitDateParts(raw);
  const yp = yearPosition(p);
  if (yp === 'first') return String(p.nums[0]);
  if (yp === 'last') return String(p.nums[2]);
  if (yp === 'assumed-last') return String(expandYear(p.nums[2] as number, 2));
  return '';
}
