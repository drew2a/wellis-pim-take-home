// Review items that need more than one file (findings: dob, signup_date; ADR-0006 orphans):
// a dob whose alternative reading flips minor/adult at one of the patient's intakes, a patient
// whose whole record sits in the future, and an orphan intake with its look-alike context.
import { ageInYears } from '@/eligibility/age';
import type { Rules } from '@/rules/schema';

import type { MappedConsentEvent } from '../mapper/consent-event';
import type { MappedIntake } from '../mapper/intake';
import type { MappedPatient } from '../mapper/patient';
import { dedupeKey, type ReviewItemDraft } from './items';
import type { Ids } from './mapping-items';

export interface Export {
  readonly patients: readonly MappedPatient[];
  readonly intakes: readonly MappedIntake[];
  readonly consents: readonly MappedConsentEvent[];
}

export function intakesByPatient(intakes: readonly MappedIntake[]): Map<string, MappedIntake[]> {
  const out = new Map<string, MappedIntake[]>();
  for (const intake of intakes) {
    const list = out.get(intake.legacyPatientId) ?? [];
    list.push(intake);
    out.set(intake.legacyPatientId, list);
  }
  return out;
}

/**
 * The convention is confirmed once as a vocabulary item; a row item only where the alternative
 * reading changes a consequence: the patient is a minor under one reading and an adult under the
 * other at the time of an intake (findings, dob: 6 patients in this export).
 */
export function dobFlipItems(data: Export, ids: Ids, rules: Rules): ReviewItemDraft[] {
  const byPatient = intakesByPatient(data.intakes);
  const minimum = rules.age.minimum_years;
  const items: ReviewItemDraft[] = [];
  for (const patient of data.patients) {
    const read = patient.canonical.dob;
    const alternative = patient.dobAlternative;
    if (read === null || alternative === null) continue;
    const flips = (byPatient.get(patient.legacyId) ?? [])
      .filter((i) => i.canonical.submittedAt !== null)
      .map((i) => {
        const at = i.canonical.submittedAt as string;
        return {
          intake_id: i.intakeId,
          submitted_at: at,
          age_under_convention: ageInYears(read, at),
          age_under_alternative: ageInYears(alternative, at),
        };
      })
      .filter((x) => x.age_under_convention < minimum !== x.age_under_alternative < minimum);
    if (flips.length === 0) continue;
    const raw =
      patient.records.find((r) => r.field === 'dob' && r.ruleCode === 'DATE_ORDER_FROM_SEPARATOR')
        ?.from ?? read;
    items.push({
      type: 'data_quality',
      scope: 'row',
      title: 'date of birth: the alternative reading flips minor/adult at an intake',
      reason: `under the convention ${read}, under the alternative ${alternative}; the age rule is ${minimum}`,
      payload: {
        legacy_id: patient.legacyId,
        raw,
        read_under_convention: read,
        alternative_reading: alternative,
        signup_date: patient.canonical.signupDate,
        intakes: flips,
      },
      proposedResolution: null,
      patientId: ids.patients.get(patient.legacyId) ?? null,
      intakeId: null,
      field: 'dob',
      dedupeKey: dedupeKey([
        'data_quality',
        'row',
        `legacy_patient:${patient.legacyId}`,
        'dob',
        'DOB_READING_FLIPS_MINOR',
        raw,
      ]),
    });
  }
  return items;
}

/** legacy ids of patients whose signup_date was blanked as impossible: their whole record is shifted. */
export function shiftedPatients(patients: readonly MappedPatient[]): Set<string> {
  return new Set(
    patients
      .filter((p) => p.flags.some((f) => f.kind === 'date_impossible' && f.field === 'signup_date'))
      .map((p) => p.legacyId),
  );
}

/**
 * One item per patient in the future, listing every date of theirs side by side: signup, each
 * intake's submitted_at, each consent event's at (findings, signup_date: 3 patients in 2062).
 */
export function shiftedPatientItems(data: Export, ids: Ids): ReviewItemDraft[] {
  const byPatient = intakesByPatient(data.intakes);
  const consentsByPatient = new Map<string, MappedConsentEvent[]>();
  for (const c of data.consents) {
    const list = consentsByPatient.get(c.legacyPatientId) ?? [];
    list.push(c);
    consentsByPatient.set(c.legacyPatientId, list);
  }
  return data.patients
    .filter((p) => shiftedPatients([p]).size === 1)
    .map((p) => {
      const flag = p.flags.find((f) => f.kind === 'date_impossible' && f.field === 'signup_date');
      const raw = flag?.raw ?? '';
      const signupRead = flag?.kind === 'date_impossible' ? flag.read : null;
      return {
        type: 'data_quality',
        scope: 'row',
        title: 'the whole patient record is dated in the future',
        reason:
          'signup_date is after the import reference date; every date of this patient is listed',
        payload: {
          legacy_id: p.legacyId,
          signup_date: { raw, read: signupRead, canonical: null },
          dob: { read: p.canonical.dob },
          intakes: (byPatient.get(p.legacyId) ?? []).map((i) => ({
            intake_id: i.intakeId,
            submitted_at: {
              raw: i.flags.find((f) => f.field === 'submitted_at')?.raw ?? i.canonical.submittedAt,
              canonical: i.canonical.submittedAt,
            },
          })),
          consent_events: (consentsByPatient.get(p.legacyId) ?? []).map((c) => ({
            source_line: c.lineNo,
            at: c.records.find((r) => r.field === 'at')?.from ?? null,
          })),
        },
        proposedResolution: null,
        patientId: ids.patients.get(p.legacyId) ?? null,
        intakeId: null,
        field: 'signup_date',
        dedupeKey: dedupeKey([
          'data_quality',
          'row',
          `legacy_patient:${p.legacyId}`,
          'signup_date',
          'DATE_IMPOSSIBLE_TO_NULL',
          raw,
        ]),
      };
    });
}

interface LookAlike {
  readonly legacy_id: string;
  readonly full_name: string;
  readonly dob: string | null;
  readonly height_cm: number | null;
  readonly weight_kg: string | null;
  readonly signup_date: string | null;
  readonly status: string;
}

const DAY = 86_400_000;
const daysBetween = (fromIso: string, toIso: string): number =>
  (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY;

/**
 * Context only, not a rule (ADR-0006): patients with the same height, a signup weight within
 * 10 % of the intake's, and a signup date at most a year before the intake.
 */
export function lookAlikes(intake: MappedIntake, patients: readonly MappedPatient[]): LookAlike[] {
  const { heightCm, weightKg, submittedAt } = intake.canonical;
  if (heightCm === null || weightKg === null) return [];
  const weight = Number(weightKg);
  return patients
    .filter((p) => {
      const c = p.canonical;
      if (c.heightCm !== heightCm || c.weightKg === null) return false;
      if (Math.abs(Number(c.weightKg) - weight) > weight * 0.1) return false;
      if (submittedAt === null || c.signupDate === null) return true;
      const days = daysBetween(c.signupDate, submittedAt);
      return days >= 0 && days <= 365;
    })
    .map((p) => ({
      legacy_id: p.legacyId,
      full_name: p.canonical.fullName,
      dob: p.canonical.dob,
      height_cm: p.canonical.heightCm,
      weight_kg: p.canonical.weightKg,
      signup_date: p.canonical.signupDate,
      status: p.canonical.status,
    }));
}

/** One orphan_intake item per intake whose patient does not exist; two actions (ADR-0006). */
export function orphanItems(
  orphans: readonly MappedIntake[],
  data: Export,
  ids: Ids,
): ReviewItemDraft[] {
  return orphans.map((intake) => ({
    type: 'orphan_intake',
    scope: 'row',
    title: `intake ${intake.intakeId} references a patient that does not exist`,
    reason: `legacy_patient_id ${intake.legacyPatientId} is in neither patients.csv nor consents.jsonl`,
    payload: {
      intake_id: intake.intakeId,
      legacy_patient_id: intake.legacyPatientId,
      intake: intake.canonical,
      look_alikes: lookAlikes(intake, data.patients),
      actions: ['attach_to_existing_patient', 'leave_unresolved'],
      note: 'attaching needs a note: even a single look-alike is a guess',
    },
    proposedResolution: null,
    patientId: null,
    intakeId: ids.intakes.get(intake.intakeId) ?? null,
    field: 'patient_id',
    dedupeKey: dedupeKey([
      'orphan_intake',
      'row',
      `legacy_intake:${intake.intakeId}`,
      'patient_id',
      'ORPHAN',
      intake.legacyPatientId,
    ]),
  }));
}
