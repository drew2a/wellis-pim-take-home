// The export's column layout, as the header names it (data-profile, "Header as exported"). The
// readers check the header against these and the raw load maps fields to columns by position.
export const PATIENTS_HEADER = [
  'legacy_id',
  'full_name',
  'email',
  'dob',
  'sex',
  'bsn',
  'phone',
  'city',
  'weight',
  'weight_unit',
  'height_cm',
  'status',
  'signup_date',
  'source',
] as const;

export const INTAKES_HEADER = [
  'intake_id',
  'legacy_patient_id',
  'submitted_at',
  'questionnaire_version',
  'weight',
  'height',
  'meds_current',
  'conditions',
  'alcohol_units_week',
  'outcome',
  'reviewer_note',
] as const;

export type PatientColumn = (typeof PATIENTS_HEADER)[number];
export type IntakeColumn = (typeof INTAKES_HEADER)[number];

/** A CSV record as a name → value map, in the export's own column names. */
export function byHeader<H extends readonly string[]>(
  header: H,
  fields: readonly string[],
): Record<H[number], string> {
  const out: Record<string, string> = {};
  header.forEach((name, i) => {
    out[name] = fields[i] ?? '';
  });
  return out;
}
