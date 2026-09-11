// Canonical column names as the schema spells them, keyed by the camelCase property of the
// mapped row. Human-owned fields are named in snake_case by whoever writes the audit entry; the
// importer compares on that spelling.
import type { CanonicalIntake } from '../mapper/intake';
import type { CanonicalPatient } from '../mapper/patient';

export const PATIENT_COLUMNS: Readonly<Record<keyof CanonicalPatient, string>> = {
  fullName: 'full_name',
  email: 'email',
  dob: 'dob',
  sex: 'sex',
  bsn: 'bsn',
  bsnCheck: 'bsn_check',
  phone: 'phone',
  city: 'city',
  weightKg: 'weight_kg',
  heightCm: 'height_cm',
  status: 'status',
  signupDate: 'signup_date',
  source: 'source',
};

export const INTAKE_COLUMNS: Readonly<Record<keyof CanonicalIntake, string>> = {
  submittedAt: 'submitted_at',
  questionnaireVersionLabel: 'questionnaire_version_label',
  questionnaireVersion: 'questionnaire_version',
  weightKg: 'weight_kg',
  heightCm: 'height_cm',
  medsCurrentRaw: 'meds_current_raw',
  medicationReport: 'medication_report',
  conditionsRaw: 'conditions_raw',
  conditionReport: 'condition_report',
  alcoholUnitsWeek: 'alcohol_units_week',
  outcome: 'outcome',
  outcomeRaw: 'outcome_raw',
  reviewerNote: 'reviewer_note',
  state: 'state',
};

export interface FieldConflict {
  readonly field: string;
  readonly stored: unknown;
  readonly mapped: unknown;
  readonly auditEntryId: string;
}

/**
 * Splits a mapped row into the columns to write and the human-owned columns whose mapped value
 * differs from the stored one. Equal values are dropped from the write so a re-run touches
 * nothing (R-A15).
 */
export function diffAgainstStored<T extends object>(
  mapped: T,
  stored: T,
  columns: Readonly<Record<keyof T, string>>,
  owned: ReadonlyMap<string, string> | undefined,
): { changes: Partial<T>; conflicts: FieldConflict[] } {
  const changes: Partial<T> = {};
  const conflicts: FieldConflict[] = [];
  for (const key of Object.keys(columns) as (keyof T)[]) {
    if (Object.is(mapped[key], stored[key])) continue;
    const auditEntryId = owned?.get(columns[key]);
    if (auditEntryId !== undefined) {
      conflicts.push({
        field: columns[key],
        stored: stored[key],
        mapped: mapped[key],
        auditEntryId,
      });
    } else {
      changes[key] = mapped[key];
    }
  }
  return { changes, conflicts };
}
