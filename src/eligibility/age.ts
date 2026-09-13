/**
 * The oldest age we treat as possible. The importer calls a date of birth giving more than this at
 * signup impossible and nulls it (ADR-0009 item 1); the intake form refuses one at the boundary
 * instead (ADR-0015 item 2). One bound, two remedies, because the form can ask again and the
 * importer cannot.
 */
export const MAX_PLAUSIBLE_AGE_YEARS = 100;

/**
 * Whole years between two ISO dates, as a birthday count.
 *
 * A 29 February birthday needs no special case: the calendar comparison makes it an adult on
 * 1 March of a non-leap year, which is the Dutch convention (ADR-0010).
 */
export function ageInYears(dobIso: string, atIso: string): number {
  const [dy, dm, dd] = dobIso.split('-').map(Number) as [number, number, number];
  const [ay, am, ad] = atIso.split('-').map(Number) as [number, number, number];
  let years = ay - dy;
  if (am < dm || (am === dm && ad < dd)) years -= 1;
  return years;
}
