// The mapped export as the rows the candidate keys read (ADR-0006). One adapter, so that
// `candidates.ts` stays free of the mapper's types and can be tested from a literal.
import type { MappedIntake } from '../mapper/intake';
import type { MappedPatient } from '../mapper/patient';
import type { IdentityRow } from './candidates';

export function identityRows(
  patients: readonly MappedPatient[],
  intakes: readonly MappedIntake[],
): IdentityRow[] {
  const intakeCount = new Map<string, number>();
  for (const intake of intakes) {
    intakeCount.set(intake.legacyPatientId, (intakeCount.get(intake.legacyPatientId) ?? 0) + 1);
  }
  return patients.map((patient) => ({
    legacyId: patient.legacyId,
    fullName: patient.canonical.fullName,
    dob: patient.canonical.dob,
    email: patient.canonical.email,
    bsn: patient.canonical.bsn,
    phone: patient.canonical.phone,
    sex: patient.canonical.sex,
    city: patient.canonical.city,
    weightKg: patient.canonical.weightKg,
    heightCm: patient.canonical.heightCm,
    status: patient.canonical.status,
    signupDate: patient.canonical.signupDate,
    source: patient.canonical.source,
    intakeCount: intakeCount.get(patient.legacyId) ?? 0,
  }));
}
