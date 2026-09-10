// Minimal valid rows for constraint tests. Each function returns the fewest columns a row needs
// to satisfy NOT NULL and CHECK, so a test that violates one constraint fails for that reason
// only. Callers override what they test.
import * as schema from '@/db/schema';

// `$inferInsert` exists only on tables; a plain lookup over the module would include the enums.
type Insert<T extends keyof typeof schema> = (typeof schema)[T] extends { $inferInsert: infer I }
  ? I
  : never;

export const importRunRow = (): Insert<'importRuns'> => ({
  importerVersion: 'test',
  dryRun: false,
  patientsSha256: 'a'.repeat(64),
  patientsBytes: 1,
  intakesSha256: 'b'.repeat(64),
  intakesBytes: 1,
  consentsSha256: 'c'.repeat(64),
  consentsBytes: 1,
});

export const legacyPatientRawRow = (importRunId: number): Insert<'legacyPatientsRaw'> => ({
  legacyId: 'rec000000000000001',
  fullName: 'Test Patient ',
  email: 'test@example.com',
  dob: '01-02-1990',
  sex: 'F',
  bsn: '',
  phone: '0612345678',
  city: 'Utrecht',
  weight: '70.5',
  weightUnit: 'kg',
  heightCm: '170',
  status: 'active ',
  signupDate: '2024-01-01',
  source: 'website',
  sourceFile: 'patients.csv',
  lineNo: 2,
  rowHash: 'd'.repeat(64),
  importRunId,
});

export const legacyIntakeRawRow = (importRunId: number): Insert<'legacyIntakesRaw'> => ({
  intakeId: 'INT-000001',
  legacyPatientId: 'rec000000000000001',
  submittedAt: '2024-01-02',
  questionnaireVersion: 'v2',
  weight: '70.5',
  height: '170',
  medsCurrent: '',
  conditions: '',
  alcoholUnitsWeek: '3',
  outcome: 'approved ',
  reviewerNote: '',
  sourceFile: 'intakes.csv',
  lineNo: 2,
  rowHash: 'e'.repeat(64),
  importRunId,
});

export const legacyConsentEventRawRow = (
  importRunId: number,
): Insert<'legacyConsentEventsRaw'> => ({
  patientLegacyId: 'rec000000000000001',
  type: 'data_processing',
  action: 'granted',
  at: '2024-01-02T10:00:00',
  version: 'v2',
  sourceFile: 'consents.jsonl',
  lineNo: 1,
  rowHash: 'f'.repeat(64),
  importRunId,
});

export const patientRow = (): Insert<'patients'> => ({
  fullName: 'Test Patient',
  sex: 'unknown',
  bsnCheck: 'absent',
  status: 'unknown',
});

export const intakeRow = (intakeId = 'INT-000001'): Insert<'intakes'> => ({
  intakeId,
  medicationReport: 'not_answered',
  conditionReport: 'not_answered',
  outcome: 'unknown',
  state: 'legacy_pending',
});

export const consentEventRow = (): Insert<'consentEvents'> => ({
  type: 'data_processing',
  action: 'granted',
  at: new Date('2024-01-02T09:00:00Z'),
});

export const normalisationRecordRow = (): Insert<'normalisationRecords'> => ({
  importerVersion: 'test',
  entityType: 'patient',
  entityId: 'rec000000000000001',
  field: 'status',
  fromValue: 'active ',
  toValue: 'active',
  ruleCode: 'TRIM_WHITESPACE',
  evidence: { profile: 'P-12' },
});

export const reviewItemRow = (
  dedupeKey = 'data_quality:patient:rec1:dob:AMBIGUOUS:01-02-1990',
): Insert<'reviewItems'> => ({
  type: 'data_quality',
  scope: 'row',
  title: 'Ambiguous date',
  payload: {},
  dedupeKey,
});

export const auditEntryRow = (): Insert<'auditEntries'> => ({
  actor: 'legacy import',
  entityType: 'intake',
  entityId: 'INT-000001',
  toState: 'legacy_approved',
  reason: 'legacy outcome',
});
