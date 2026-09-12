// Target schema of ADR-0004 (tables, enums, constraints), amended by ADR-0007 (append-only
// evidence tables, consent timestamps) and ADR-0008 (idempotency keys under immutability,
// provenance columns, cross-column CHECKs). Constraints live here and in the generated SQL under
// drizzle/, not only in application code (ADR-0003). Vocabulary is CLAUDE.md §6.
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { ELIGIBILITY_OUTCOMES, type EvaluatedInputs } from '@/eligibility/types';

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
// The engine's own vocabulary, generated from the engine's list so the two cannot drift. It is
// not the legacy outcome vocabulary above and never translated into it: `not_evaluable` has no
// image there, and a translated copy of a verdict is a second value that can disagree with the
// first (ADR-0011 item 1).
export const engineOutcomeEnum = pgEnum('engine_outcome', ELIGIBILITY_OUTCOMES);
export type EngineOutcome = (typeof engineOutcomeEnum.enumValues)[number];
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
  // The reference date for every "future" judgement of the run (impossible dates, future-dated
  // consent events): the --as-of argument, never the wall clock, so a run is reproducible from
  // its row (ADR-0009).
  asOf: date('as_of', { mode: 'string' }).notNull(),
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

// line_no is declared per table, not here: it is a plain column on the CSV tables and the
// primary key on the consent table, and a spread that one table then overrides is easy to misread.
const rawBookkeeping = {
  sourceFile: text('source_file').notNull(),
  rowHash: text('row_hash').notNull(),
  importRunId: importRunRef('import_run_id').notNull(),
};

export const legacyPatientsRaw = pgTable(
  'legacy_patients_raw',
  {
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
    lineNo: integer('line_no').notNull(),
    ...rawBookkeeping,
  },
  (table) => [index('legacy_patients_raw_import_run_id_idx').on(table.importRunId)],
);

export const legacyIntakesRaw = pgTable(
  'legacy_intakes_raw',
  {
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
    lineNo: integer('line_no').notNull(),
    ...rawBookkeeping,
  },
  (table) => [index('legacy_intakes_raw_import_run_id_idx').on(table.importRunId)],
);

// The file has no id, so the line number is the key (ADR-0004). Every line carries all five
// keys as strings (data-profile P-29, P-30), hence NOT NULL throughout.
export const legacyConsentEventsRaw = pgTable(
  'legacy_consent_events_raw',
  {
    patientLegacyId: text('patient_legacy_id').notNull(),
    type: text('type').notNull(),
    action: text('action').notNull(),
    at: text('at').notNull(),
    version: text('version').notNull(),
    lineNo: integer('line_no').primaryKey(),
    ...rawBookkeeping,
  },
  (table) => [index('legacy_consent_events_raw_import_run_id_idx').on(table.importRunId)],
);

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
    // The legacy row this canonical row was built from; null for a patient the new flow created.
    // It never changes, which is what `patient_legacy_ids` cannot promise: a merge repoints the
    // alias, so after one the alias answers "whose records are these now" and this column answers
    // "which exported row is this" — the question a re-run of the importer asks (ADR-0011 item 18).
    createdFromLegacyId: text('created_from_legacy_id').unique(),
    // Null for patients created by the new intake flow (Part B).
    createdByRun: importRunRef('created_by_run'),
  },
  (table) => [
    check('patients_bsn_nine_digits', sql`${table.bsn} ~ '^[0-9]{9}$'`),
    // An absent number cannot have been checked valid or invalid (ADR-0008).
    check(
      'patients_bsn_check_absent_when_null',
      sql`${table.bsn} is not null or ${table.bsnCheck} = 'absent'`,
    ),
    check('patients_phone_dutch_mobile', sql`${table.phone} ~ '^\\+316[0-9]{8}$'`),
    check('patients_weight_kg_positive', sql`${table.weightKg} > 0`),
    check('patients_height_cm_positive', sql`${table.heightCm} > 0`),
    // A self-merge would loop survivor resolution forever (ADR-0008).
    check('patients_merged_into_not_self', sql`${table.mergedInto} <> ${table.id}`),
    index('patients_merged_into_idx').on(table.mergedInto),
    index('patients_created_by_run_idx').on(table.createdByRun),
  ],
);

// Every legacy id resolves to exactly one patient, also after a merge: the importer resolves
// legacy_patient_id through this table at load and a merge repoints the losing id here. It is a
// mapping, not the membership mechanism: "this patient's records" are answered by one repository
// function walking merged_into, never by a join on a copied patient_id alone (ADR-0008).
export const patientLegacyIds = pgTable(
  'patient_legacy_ids',
  {
    legacyId: text('legacy_id').primaryKey(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
  },
  (table) => [index('patient_legacy_ids_patient_id_idx').on(table.patientId)],
);

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
    // Null for intakes submitted through the new flow (ADR-0008).
    createdByRun: importRunRef('created_by_run'),
  },
  (table) => [
    check('intakes_weight_kg_positive', sql`${table.weightKg} > 0`),
    check('intakes_height_cm_positive', sql`${table.heightCm} > 0`),
    index('intakes_patient_id_idx').on(table.patientId),
    index('intakes_created_by_run_idx').on(table.createdByRun),
    // The console's work queue and status filter select on state (ADR-0004).
    index('intakes_state_idx').on(table.state),
  ],
);

// Evidence: never updated (ADR-0004), enforced by trigger (ADR-0007).
export const consentEvents = pgTable(
  'consent_events',
  {
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
  },
  (table) => [
    // The trigger forbids delete-and-rewrite, so the re-run's ON CONFLICT DO NOTHING needs this
    // target; new-flow events have no line and are never re-imported (ADR-0008).
    uniqueIndex('consent_events_source_line_unique')
      .on(table.sourceLine)
      .where(sql`${table.sourceLine} is not null`),
    index('consent_events_patient_id_idx').on(table.patientId),
    index('consent_events_import_run_id_idx').on(table.importRunId),
  ],
);

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
  (table) => [
    // patient_id leads the primary key, so it needs no index of its own.
    primaryKey({ columns: [table.patientId, table.type] }),
    index('consent_states_derived_from_event_id_idx').on(table.derivedFromEventId),
  ],
);

export const eligibilityEvaluations = pgTable(
  'eligibility_evaluations',
  {
    id: uuidPrimaryKey(),
    intakeId: uuid('intake_id')
      .notNull()
      .references(() => intakes.id),
    rulesetVersion: text('ruleset_version').notNull(),
    // The engine's verdict, in the engine's vocabulary (ADR-0011 item 1).
    engineOutcome: engineOutcomeEnum('engine_outcome').notNull(),
    reasons: jsonb('reasons').$type<string[]>().notNull(),
    // What the rules saw: age, weight, height, the unrounded BMI and the matched terms with the
    // text that matched them, so the row explains itself without re-running the engine (ADR-0010).
    inputs: jsonb('inputs').$type<EvaluatedInputs>().notNull(),
    // True for legacy intakes evaluated at import, where nothing is applied (ADR-0005).
    shadow: boolean('shadow').notNull(),
    evaluatedAt: timestamptz('evaluated_at').notNull().defaultNow(),
    importRunId: importRunRef('import_run_id'),
  },
  (table) => [
    // A shadow row is derived from (intake, ruleset) and is recomputed on every run, so the
    // upsert needs this target; Part B's rows record what a patient was told at submission and
    // each one is a new fact (ADR-0011 item 2).
    uniqueIndex('eligibility_evaluations_shadow_unique')
      .on(table.intakeId, table.rulesetVersion)
      .where(sql`${table.shadow}`),
    index('eligibility_evaluations_intake_id_idx').on(table.intakeId),
    index('eligibility_evaluations_import_run_id_idx').on(table.importRunId),
  ],
);

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
    // Raw values are text and never null (an empty cell is '').
    fromValue: text('from_value').notNull(),
    // Null when the rule blanks the value (implausible weight, impossible date).
    toValue: text('to_value'),
    ruleCode: text('rule_code').notNull(),
    // The P-n / H-n reference and the counts that justified the rule.
    evidence: jsonb('evidence').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    // to_value is in the key (ADR-0008): a later importer version mapping the same raw value
    // elsewhere is a new fact, and the old row cannot be edited. NULLS NOT DISTINCT so that a
    // rule that blanks a value dedupes on re-run like any other.
    unique('normalisation_records_dedupe')
      .on(
        table.entityType,
        table.entityId,
        table.field,
        table.ruleCode,
        table.fromValue,
        table.toValue,
      )
      .nullsNotDistinct(),
    index('normalisation_records_import_run_id_idx').on(table.importRunId),
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
    // A closed decision without actor and time is an audit gap (R-B20, ADR-0008).
    check(
      'review_items_resolver_on_close',
      sql`${table.status} = 'open' or (${table.resolvedBy} is not null and ${table.resolvedAt} is not null)`,
    ),
    index('review_items_patient_id_idx').on(table.patientId),
    index('review_items_intake_id_idx').on(table.intakeId),
    index('review_items_created_by_run_idx').on(table.createdByRun),
    // The console's queue is "open items", filtered by type (R-C2).
    index('review_items_status_idx').on(table.status),
    index('review_items_type_idx').on(table.type),
  ],
);

// Append-only (R-B21): UPDATE, DELETE and TRUNCATE are rejected by trigger (ADR-0007).
export const auditEntries = pgTable(
  'audit_entries',
  {
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
    // Importer-written entries: deterministic from (entity_type, entity_id, from_state, to_state,
    // reason), the re-run's ON CONFLICT target under the append-only trigger. Null for human
    // entries, each of which is a new event (ADR-0008) — which is also what lets a transition
    // repeat: only a human can merge a pair a human separated (ADR-0012).
    dedupeKey: text('dedupe_key').unique(),
  },
  (table) => [
    index('audit_entries_review_item_id_idx').on(table.reviewItemId),
    // The patient detail view reads the audit timeline by entity, and this table only grows.
    index('audit_entries_entity_idx').on(table.entityType, table.entityId),
  ],
);

export interface AuditChange {
  field: string;
  from: string | null;
  to: string | null;
  source_legacy_id?: string;
}
