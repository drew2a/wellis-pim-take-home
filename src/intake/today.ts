/**
 * The day the intake form's answers are measured against — "in the past", and the age a date of
 * birth implies.
 *
 * One definition, because the page renders the date field's bounds and the routes validate what
 * comes back, and a form that offers a day its own server refuses would be a bug the patient
 * cannot act on. It is the **UTC** calendar day, which is not the clinic's day in Europe/Amsterdam
 * between midnight and 02:00 local.
 */
export const todayIso = (): string => new Date().toISOString().slice(0, 10);
