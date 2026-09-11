// One legacy patient row to its canonical row (ADR-0004 `patients`), by the ADR-0005 mapping
// table. Pure: no I/O, no clock; --as-of and the rules file come in as arguments.
import type { Rules } from '@/rules/schema';

import type { PatientColumn } from '../source/layout';
import { mapBsn, type BsnCheck } from './bsn';
import { alternativeReading, mapDate } from './dates';
import { mapEmail } from './email';
import { mapHeight, mapPatientWeight } from './numbers';
import { mapPhone } from './phone';
import { trimWhitespace } from './text';
import type { Flag, Mapped, RecordDraft } from './types';
import { SEX, STATUS, mapVocabulary, type PatientStatus, type Sex } from './vocabulary';

export type RawPatient = Readonly<Record<PatientColumn, string>>;

export interface CanonicalPatient {
  readonly fullName: string;
  readonly email: string | null;
  readonly dob: string | null;
  readonly sex: Sex;
  readonly bsn: string | null;
  readonly bsnCheck: BsnCheck;
  readonly phone: string | null;
  readonly city: string | null;
  readonly weightKg: string | null;
  readonly heightCm: number | null;
  readonly status: PatientStatus;
  readonly signupDate: string | null;
  readonly source: string | null;
}

export interface MappedPatient {
  readonly legacyId: string;
  readonly canonical: CanonicalPatient;
  readonly records: readonly RecordDraft[];
  readonly flags: readonly Flag[];
  /** The dob the convention would give if it were wrong; the review layer's minor/adult check. */
  readonly dobAlternative: string | null;
}

export interface MappingContext {
  readonly asOf: string;
  readonly rules: Rules;
}

/** Empty is empty: an empty raw text column is null, with no record (ADR-0009 item 1). */
export const emptyToNull = (raw: string): string | null => (raw === '' ? null : raw);

export function collect(records: RecordDraft[], flags: Flag[]): <T>(mapped: Mapped<T>) => T {
  return (mapped) => {
    records.push(...mapped.records);
    flags.push(...mapped.flags);
    return mapped.value;
  };
}

export function mapPatient(raw: RawPatient, context: MappingContext): MappedPatient {
  const records: RecordDraft[] = [];
  const flags: Flag[] = [];
  const take = collect(records, flags);
  const { plausibility } = context.rules;

  // Signup first: the dob's age check needs it.
  const signupDate = take(mapDate(raw.signup_date, 'signup_date', { asOf: context.asOf }));
  const dob = take(mapDate(raw.dob, 'dob', { asOf: context.asOf, signupIso: signupDate }));
  const bsn = take(mapBsn(raw.bsn));

  return {
    legacyId: raw.legacy_id,
    canonical: {
      fullName: take(trimWhitespace(raw.full_name, 'full_name')),
      email: take(mapEmail(raw.email)),
      dob,
      sex: take(mapVocabulary(raw.sex, SEX)),
      bsn: bsn.bsn,
      bsnCheck: bsn.bsnCheck,
      phone: take(mapPhone(raw.phone)),
      city: emptyToNull(raw.city),
      weightKg: take(mapPatientWeight(raw.weight, raw.weight_unit, plausibility.weight_kg)),
      heightCm: take(mapHeight(raw.height_cm, plausibility.height_cm)),
      status: take(mapVocabulary(raw.status, STATUS)),
      signupDate,
      source: emptyToNull(raw.source),
    },
    records,
    flags,
    dobAlternative: alternativeReading(raw.dob),
  };
}
