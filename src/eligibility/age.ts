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
