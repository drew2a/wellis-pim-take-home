// Target schema of ADR-0004 (tables, enums, constraints), amended by ADR-0007 (append-only
// evidence tables, consent timestamps). Constraints live here and in the generated SQL under
// drizzle/, not only in application code (ADR-0003). Vocabulary is CLAUDE.md §6.
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------------------------

export const sexEnum = pgEnum('sex', ['male', 'female', 'unknown']);
export const bsnCheckEnum = pgEnum('bsn_check', ['valid', 'invalid', 'absent']);
export const patientStatusEnum = pgEnum('patient_status', [
  'active',
  'paused',
  'churned',
  'prospect',
  'unknown',
]);
export const questionnaireVersionEnum = pgEnum('questionnaire_version', ['v1', 'v2', 'v3']);
// Shared by intakes.medication_report and intakes.condition_report (ADR-0004).
export const historyReportEnum = pgEnum('history_report', [
  'none_reported',
  'not_answered',
  'reported',
]);
export const outcomeEnum = pgEnum('outcome', ['approved', 'rejected', 'pending', 'unknown']);
// Legacy states are terminal and filterable; the rest belong to the Part B state machine.
export const intakeStateEnum = pgEnum('intake_state', [
  'legacy_approved',
  'legacy_rejected',
  'legacy_pending',
  'legacy_expired',
  'draft',
  'submitted',
  'auto_cleared',
  'auto_flagged',
  'auto_rejected',
  'in_review',
  'approved',
  'rejected',
]);
export const consentActionEnum = pgEnum('consent_action', ['granted', 'revoked']);
export const consentStateEnum = pgEnum('consent_state', [
  'granted',
  'revoked',
  'no_record',
  'unknown_pre_log',
  'conflict',
]);
export const reviewItemTypeEnum = pgEnum('review_item_type', [
  'data_quality',
  'identity_conflict',
  'orphan_intake',
  'duplicate_intake',
  'consent',
  'clinical_history',
  'vocabulary',
]);
export const reviewItemScopeEnum = pgEnum('review_item_scope', ['row', 'vocabulary']);
export const reviewItemStatusEnum = pgEnum('review_item_status', ['open', 'resolved', 'dismissed']);

// ---------------------------------------------------------------------------------------------
// Shared column builders
// ---------------------------------------------------------------------------------------------

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

const uuidPrimaryKey = () => uuid('id').primaryKey().defaultRandom();

// ---------------------------------------------------------------------------------------------
// Import bookkeeping
// ---------------------------------------------------------------------------------------------

export const importRuns = pgTable('import_runs', {
  // Integer, not uuid: review items and the report refer to "import run N" (ADR-0004).
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  startedAt: timestamptz('started_at').notNull().defaultNow(),
  finishedAt: timestamptz('finished_at'),
  importerVersion: text('importer_version').notNull(),
  dryRun: boolean('dry_run').notNull(),
  // The export is exactly three files (ASSIGNMENT.md §2); columns beat a jsonb map here.
  patientsSha256: text('patients_sha256').notNull(),
  patientsBytes: integer('patients_bytes').notNull(),
  intakesSha256: text('intakes_sha256').notNull(),
  intakesBytes: integer('intakes_bytes').notNull(),
  consentsSha256: text('consents_sha256').notNull(),
  consentsBytes: integer('consents_bytes').notNull(),
  // Null for a dry run, which prints the report and writes nothing.
  reportPath: text('report_path'),
});

const importRunRef = (name: string) => integer(name).references(() => importRuns.id);

// ---------------------------------------------------------------------------------------------
// Raw layer: one table per source file, every source column as text exactly as exported,
// untrimmed (R-A8). Column order follows the header in docs/profile/data-profile.md.
// ---------------------------------------------------------------------------------------------

const rawBookkeeping = {
  sourceFile: text('source_file').notNull(),
  lineNo: integer('line_no').notNull(),
  rowHash: text('row_hash').notNull(),
  importRunId: importRunRef('import_run_id').notNull(),
};

export const legacyPatientsRaw = pgTable('legacy_patients_raw', {
  legacyId: text('legacy_id').primaryKey(),
  fullName: text('full_name').notNull(),
  email: text('email').notNull(),
  dob: text('dob').notNull(),
  sex: text('sex').notNull(),
  bsn: text('bsn').notNull(),
  phone: text('phone').notNull(),
  city: text('city').notNull(),
  weight: text('weight').notNull(),
  weightUnit: text('weight_unit').notNull(),
  heightCm: text('height_cm').notNull(),
  status: text('status').notNull(),
  signupDate: text('signup_date').notNull(),
  source: text('source').notNull(),
  ...rawBookkeeping,
});

export const legacyIntakesRaw = pgTable('legacy_intakes_raw', {
  intakeId: text('intake_id').primaryKey(),
  legacyPatientId: text('legacy_patient_id').notNull(),
  submittedAt: text('submitted_at').notNull(),
  questionnaireVersion: text('questionnaire_version').notNull(),
  weight: text('weight').notNull(),
  height: text('height').notNull(),
  medsCurrent: text('meds_current').notNull(),
  conditions: text('conditions').notNull(),
  alcoholUnitsWeek: text('alcohol_units_week').notNull(),
  outcome: text('outcome').notNull(),
  reviewerNote: text('reviewer_note').notNull(),
  ...rawBookkeeping,
});

// The file has no id, so the line number is the key (ADR-0004). Every line carries all five
// keys as strings (data-profile P-29, P-30), hence NOT NULL throughout.
export const legacyConsentEventsRaw = pgTable('legacy_consent_events_raw', {
  patientLegacyId: text('patient_legacy_id').notNull(),
  type: text('type').notNull(),
  action: text('action').notNull(),
  at: text('at').notNull(),
  version: text('version').notNull(),
  ...rawBookkeeping,
  lineNo: integer('line_no').primaryKey(),
});

// ---------------------------------------------------------------------------------------------
// Canonical layer
// ---------------------------------------------------------------------------------------------

export const patients = pgTable(
  'patients',
  {
    id: uuidPrimaryKey(),
    fullName: text('full_name').notNull(),
    // Trimmed and lowercased; null for placeholders and unresolved internal-space addresses.
    email: text('email'),
    // Null when the raw value cannot be a date (data-profile: `99-99-9999`).
    dob: date('dob', { mode: 'string' }),
    sex: sexEnum('sex').notNull(),
    bsn: text('bsn'),
    bsnCheck: bsnCheckEnum('bsn_check').notNull(),
    phone: text('phone'),
    city: text('city'),
    weightKg: numeric('weight_kg', { precision: 5, scale: 1 }),
    heightCm: integer('height_cm'),
    status: patientStatusEnum('status').notNull(),
    signupDate: date('signup_date', { mode: 'string' }),
    source: text('source'),
    // A merged patient stays and points at the survivor (ADR-0004, ADR-0006).
    mergedInto: uuid('merged_into').references((): AnyPgColumn => patients.id),
    // Null for patients created by the new intake flow (Part B).
    createdByRun: importRunRef('created_by_run'),
  },
  (table) => [
    check('patients_bsn_nine_digits', sql`${table.bsn} ~ '^[0-9]{9}$'`),
    check('patients_phone_dutch_mobile', sql`${table.phone} ~ '^\\+316[0-9]{8}$'`),
    check('patients_weight_kg_positive', sql`${table.weightKg} > 0`),
    check('patients_height_cm_positive', sql`${table.heightCm} > 0`),
  ],
);

// Every legacy id resolves to exactly one patient, also after a merge; intakes and consent
// events join through this table, never through a copied patient_id alone (ADR-0004).
export const patientLegacyIds = pgTable('patient_legacy_ids', {
  legacyId: text('legacy_id').primaryKey(),
  patientId: uuid('patient_id')
    .notNull()
    .references(() => patients.id),
});

export const intakes = pgTable(
  'intakes',
  {
    id: uuidPrimaryKey(),
    intakeId: text('intake_id').notNull().unique(),
    // As exported; null for intakes submitted through the new flow.
    legacyPatientId: text('legacy_patient_id'),
    // Null for the orphans whose legacy patient does not exist (ADR-0006).
    patientId: uuid('patient_id').references(() => patients.id),
    submittedAt: date('submitted_at', { mode: 'string' }),
    questionnaireVersionLabel: text('questionnaire_version_label'),
    questionnaireVersion: questionnaireVersionEnum('questionnaire_version'),
    weightKg: numeric('weight_kg', { precision: 5, scale: 1 }),
    heightCm: integer('height_cm'),
    medsCurrentRaw: text('meds_current_raw'),
    medicationReport: historyReportEnum('medication_report').notNull(),
    conditionsRaw: text('conditions_raw'),
    conditionReport: historyReportEnum('condition_report').notNull(),
    alcoholUnitsWeek: integer('alcohol_units_week'),
    outcome: outcomeEnum('outcome').notNull(),
    outcomeRaw: text('outcome_raw'),
    reviewerNote: text('reviewer_note'),
    state: intakeStateEnum('state').notNull(),
    // Null for legacy intakes; Part B fills it from the ruleset that evaluated the intake.
    rulesetVersion: text('ruleset_version'),
  },
  (table) => [
    check('intakes_weight_kg_positive', sql`${table.weightKg} > 0`),
    check('intakes_height_cm_positive', sql`${table.heightCm} > 0`),
  ],
);

// Evidence: never updated (ADR-0004), enforced by trigger (ADR-0007).
export const consentEvents = pgTable('consent_events', {
  id: uuidPrimaryKey(),
  // Resolved through patient_legacy_ids at load; null when the legacy id has no patient.
  patientId: uuid('patient_id').references(() => patients.id),
  legacyPatientId: text('legacy_patient_id'),
  type: text('type').notNull(),
  action: consentActionEnum('action').notNull(),
  // An instant (ADR-0007): legacy wall-clock values are converted via Europe/Amsterdam at
  // import with a TIMESTAMP_ZONE_ASSUMED normalisation record; new-flow events carry a zone.
  at: timestamptz('at').notNull(),
  version: text('version'),
  // Line in consents.jsonl; null for events raised by the new flow.
  sourceLine: integer('source_line'),
  importRunId: importRunRef('import_run_id'),
});

// Derived, recomputed by one pure function on import and on every new event (ADR-0005).
export const consentStates = pgTable(
  'consent_states',
  {
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    type: text('type').notNull(),
    state: consentStateEnum('state').notNull(),
    // Null when the state is no_record.
    derivedFromEventId: uuid('derived_from_event_id').references(() => consentEvents.id),
    derivationVersion: text('derivation_version').notNull(),
    computedAt: timestamptz('computed_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.patientId, table.type] })],
);

export const eligibilityEvaluations = pgTable('eligibility_evaluations', {
  id: uuidPrimaryKey(),
  intakeId: uuid('intake_id')
    .notNull()
    .references(() => intakes.id),
  rulesetVersion: text('ruleset_version').notNull(),
  // The engine's verdict in the vocabulary of the legacy outcome it is compared with.
  outcome: outcomeEnum('outcome').notNull(),
  reasons: jsonb('reasons').$type<string[]>().notNull(),
  // True for legacy intakes evaluated at import, where nothing is applied (ADR-0005).
  shadow: boolean('shadow').notNull(),
  evaluatedAt: timestamptz('evaluated_at').notNull().defaultNow(),
  importRunId: importRunRef('import_run_id'),
});

// ---------------------------------------------------------------------------------------------
// Records and decisions
// ---------------------------------------------------------------------------------------------

// Evidence: never updated, enforced by trigger (ADR-0007).
export const normalisationRecords = pgTable(
  'normalisation_records',
  {
    id: uuidPrimaryKey(),
    importRunId: importRunRef('import_run_id'),
    importerVersion: text('importer_version').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    field: text('field').notNull(),
    // Raw values are text and never null (an empty cell is ''), which the unique key below
    // relies on: a NULL in a unique key would let a re-run duplicate the record.
    fromValue: text('from_value').notNull(),
    // Null when the rule blanks the value (implausible weight, impossible date).
    toValue: text('to_value'),
    ruleCode: text('rule_code').notNull(),
    // The P-n / H-n reference and the counts that justified the rule.
    evidence: jsonb('evidence').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('normalisation_records_dedupe').on(
      table.entityType,
      table.entityId,
      table.field,
      table.ruleCode,
      table.fromValue,
    ),
  ],
);

export const reviewItems = pgTable(
  'review_items',
  {
    id: uuidPrimaryKey(),
    type: reviewItemTypeEnum('type').notNull(),
    scope: reviewItemScopeEnum('scope').notNull(),
    title: text('title').notNull(),
    reason: text('reason'),
    // Competing versions side by side, or the row list of a vocabulary item.
    payload: jsonb('payload').notNull(),
    proposedResolution: jsonb('proposed_resolution'),
    patientId: uuid('patient_id').references(() => patients.id),
    intakeId: uuid('intake_id').references(() => intakes.id),
    status: reviewItemStatusEnum('status').notNull().default('open'),
    // The canonical field the item is about; part of dedupe_key so two ambiguous fields on one
    // entity are two items.
    field: text('field'),
    // Deterministic from (type, entity, field, rule, raw value): a re-run neither duplicates an
    // open item nor re-opens a resolved one (R-A15, R-A17).
    dedupeKey: text('dedupe_key').notNull().unique(),
    createdByRun: importRunRef('created_by_run'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    resolvedBy: text('resolved_by'),
    resolvedAt: timestamptz('resolved_at'),
    resolutionNote: text('resolution_note'),
    // What was chosen or edited.
    resolution: jsonb('resolution'),
  },
  (table) => [
    // "resolution_note (required on resolve)" — ADR-0004.
    check(
      'review_items_resolution_note_on_close',
      sql`${table.status} = 'open' or ${table.resolutionNote} is not null`,
    ),
  ],
);

// Append-only (R-B21): UPDATE, DELETE and TRUNCATE are rejected by trigger (ADR-0007).
export const auditEntries = pgTable('audit_entries', {
  id: uuidPrimaryKey(),
  // Human identity or named process such as `legacy import` (R-B20).
  actor: text('actor').notNull(),
  at: timestamptz('at').notNull().defaultNow(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  fromState: text('from_state'),
  toState: text('to_state'),
  reason: text('reason').notNull(),
  reviewItemId: uuid('review_item_id').references(() => reviewItems.id),
  // `{field, from, to, source_legacy_id}` per changed value: human edits, and the field-level
  // provenance of the importer's tier-1 merges (ADR-0006).
  changes: jsonb('changes').$type<AuditChange[]>(),
});

export interface AuditChange {
  field: string;
  from: string | null;
  to: string | null;
  source_legacy_id?: string;
}
