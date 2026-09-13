/**
 * The calendar day the intake flow measures against — "in the past", the age a date of birth
 * implies, `signup_date` and `submitted_at` (ADR-0017).
 *
 * It is the **clinic's** day, not UTC. Wellis is in the Netherlands, which runs an hour or two
 * ahead of UTC, so between local midnight and 02:00 the UTC day is still yesterday. A submission in
 * that window taken as UTC dates a patient a day early, and for someone turning 18 that day the
 * consequence is `age_below_minimum` — an absolute reject that no doctor can override (ADR-0014
 * item 5). One named zone, one definition, so the date field the page renders and the schema the
 * API validates with cannot disagree about what day it is.
 */
export const CLINIC_TIME_ZONE = 'Europe/Amsterdam';

const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: CLINIC_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * The clinic's calendar day containing this instant, as `YYYY-MM-DD`.
 *
 * Assembled from the formatted parts rather than from a locale whose output happens to look like
 * ISO: the shape is ours, and a runtime with a different ICU cannot quietly change it.
 */
export function dayOf(at: Date): string {
  const parts = PARTS.formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((candidate) => candidate.type === type);
    if (part === undefined) throw new Error(`the ${CLINIC_TIME_ZONE} day has no ${type} part`);
    return part.value;
  };
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export const todayIso = (): string => dayOf(new Date());
