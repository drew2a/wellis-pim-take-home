// The import report, built by counting the loaded database (R-A18 to R-A23, ADR-0011 item 14).
//
// It runs inside the import transaction, which is what lets `--dry-run` print a true report and
// still write nothing: a report built after the rollback would count an empty database. Nothing
// here writes; the CLI renders the result to `reports/` and stamps `import_runs.report_path`.
//
// Two figures are not a count of any column and say so where they are built: the per-rule hits of
// the shadow evaluation come from the engine (ADR-0011 item 21: nothing stores `matched`), and the
// consent states per legacy row come from the same pure derivation applied to each row's own
// events, because a row a merge took away holds no state of its own (ADR-0011 item 13).
import { eq, isNotNull, sql, type SQL } from 'drizzle-orm';

import { deriveConsentStates, type ConsentEventInput } from '@/consent/derive';
import type { Queryable } from '@/db/queryable';
import {
  consentEvents as consentEventsTable,
  importRuns,
  patients as patientsTable,
} from '@/db/schema';
import { MATCHED_RULES } from '@/eligibility/types';
import { MERGED_INTO } from '@/repo/merge';
import type { Rules } from '@/rules/schema';

import { humanOwnedFields } from '../canonical/human-owned';
import { consentItems, type ConsentSubject } from '../detect/consent';
import { RULE_CODES, type RuleCode } from '../mapper/rule-codes';
import { ruleOf } from '../review/items';
import { IMPORTER_VERSION } from '../version';
import type {
  Assumption,
  Consent,
  Identity,
  ImportReport,
  MatrixCell,
  RuleApplied,
  ShadowEvaluationReport,
  Tally,
  UnexpectedFinding,
  WhatCameIn,
  WhatWasCleaned,
  WhatWasQuarantined,
} from './types';

export interface ReportInput {
  /** The run whose files the report names. The id itself never reaches the report. */
  readonly runId: number;
  readonly asOf: string;
  readonly rules: Rules;
  /**
   * Legacy intakes each rule fired on, as the engine reports them (`EligibilityResult.matched`).
   * The column that would let this be a `SELECT` does not exist, and re-deriving the hits from
   * the stored inputs would be a second implementation of the rules (ADR-0011 item 21).
   */
  readonly ruleHits: Readonly<Record<string, number>>;
  readonly declaredConsentTypes: readonly string[];
}

type Row = Record<string, unknown>;

async function rows<T extends Row>(db: Queryable, statement: SQL): Promise<T[]> {
  // drizzle's `Assume<T, Row>` does not reduce for a generic parameter, so the row shape is
  // asserted once here; every number read out of it then passes through `count` below.
  return [...(await db.execute<T>(statement))] as T[];
}

async function one<T extends Row>(db: Queryable, statement: SQL): Promise<T> {
  const [row] = await rows<T>(db, statement);
  if (row === undefined) throw new Error('a report query returned no row');
  return row;
}

/** Counts arrive as `int4`; anything else means the query changed and must not pass silently. */
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`a report query returned ${JSON.stringify(value)} where a count was expected`);
  }
  return value;
}

const byKey = (a: { key: string }, b: { key: string }): number => a.key.localeCompare(b.key);

function tally(entries: Iterable<readonly [string, number]>): Tally[] {
  return [...entries].map(([key, n]) => ({ key, rows: n })).sort(byKey);
}

function tallyOf(counted: readonly { readonly key: string; readonly n: number }[]): Tally[] {
  const out = new Map<string, number>();
  for (const row of counted) out.set(row.key, (out.get(row.key) ?? 0) + row.n);
  return tally(out);
}

// ---------------------------------------------------------------------------------------------
// What came in (R-A19)
// ---------------------------------------------------------------------------------------------

async function whatCameIn(
  db: Queryable,
  input: ReportInput,
  items: readonly StoredItem[],
): Promise<WhatCameIn> {
  const [run] = await db.select().from(importRuns).where(eq(importRuns.id, input.runId));
  if (run === undefined) throw new Error(`import run ${input.runId} has no row`);
  const c = await one(
    db,
    sql`select
      (select count(*) from legacy_patients_raw)::int as "rawPatients",
      (select count(*) from legacy_intakes_raw)::int as "rawIntakes",
      (select count(*) from legacy_consent_events_raw)::int as "rawConsentEvents",
      (select count(*) from patients where created_from_legacy_id is not null)::int as "patients",
      (select count(*) from patients
        where created_from_legacy_id is not null and merged_into is null)::int as "surviving",
      (select count(*) from patient_legacy_ids)::int as "legacyIds",
      (select count(*) from intakes where legacy_patient_id is not null)::int as "intakes",
      (select count(*) from intakes
        where legacy_patient_id is not null and patient_id is null)::int as "orphans",
      (select count(*) from consent_events where source_line is not null)::int as "consentEvents",
      (select count(*) from consent_events
        where source_line is not null and patient_id is null)::int as "eventsWithoutPatient"`,
  );
  const patients = count(c.patients);
  return {
    files: [
      { name: 'patients.csv', bytes: run.patientsBytes, sha256: run.patientsSha256 },
      { name: 'intakes.csv', bytes: run.intakesBytes, sha256: run.intakesSha256 },
      { name: 'consents.jsonl', bytes: run.consentsBytes, sha256: run.consentsSha256 },
    ],
    // In file order rather than sorted: this table sits under the files table and answers it.
    rawRows: [
      { key: 'legacy_patients_raw', rows: count(c.rawPatients) },
      { key: 'legacy_intakes_raw', rows: count(c.rawIntakes) },
      { key: 'legacy_consent_events_raw', rows: count(c.rawConsentEvents) },
    ],
    repeatedKeys: itemsWithRule(items, 'SOURCE_KEY_REPEATED'),
    changedSinceEarlierRun: itemsWithRule(items, 'SOURCE_ROW_CHANGED'),
    patients: {
      legacyRows: patients,
      surviving: count(c.surviving),
      mergedAway: patients - count(c.surviving),
      legacyIdsResolving: count(c.legacyIds),
    },
    intakes: { rows: count(c.intakes), orphans: count(c.orphans) },
    consentEvents: {
      rows: count(c.consentEvents),
      withoutPatient: count(c.eventsWithoutPatient),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// What was cleaned (R-A20)
// ---------------------------------------------------------------------------------------------

async function whatWasCleaned(db: Queryable): Promise<WhatWasCleaned> {
  const perField = await rows<{
    rule: string;
    field: string;
    rows: number;
    blanked: number;
  }>(
    db,
    sql`select rule_code as rule, field, count(*)::int as rows,
          count(*) filter (where to_value is null)::int as blanked
        from normalisation_records group by 1, 2`,
  );
  const byRule = new Map<string, { rows: number; blanked: number; fields: Map<string, number> }>();
  for (const row of perField) {
    const entry = byRule.get(row.rule) ?? { rows: 0, blanked: 0, fields: new Map() };
    entry.rows += count(row.rows);
    entry.blanked += count(row.blanked);
    entry.fields.set(row.field, count(row.rows));
    byRule.set(row.rule, entry);
  }
  const daylight = await one(
    db,
    sql`select
      count(*) filter (where evidence->>'ambiguous' = 'true')::int as "ambiguous",
      count(*) filter (where evidence->>'nonexistent' = 'true')::int as "nonexistent"
      from normalisation_records`,
  );
  const applied: RuleApplied[] = [...byRule.entries()]
    .map(([rule, entry]) => ({
      rule,
      rows: entry.rows,
      blanked: entry.blanked,
      fields: tally(entry.fields),
      evidence: evidenceFor(rule),
    }))
    .sort((a, b) => a.rule.localeCompare(b.rule));
  return {
    records: applied.reduce((n, rule) => n + rule.rows, 0),
    byRule: applied,
    daylightSaving: {
      ambiguous: count(daylight.ambiguous),
      nonexistent: count(daylight.nonexistent),
    },
  };
}

/** The rule's static P-n / H-n reference, from the one table that holds it (ADR-0005). */
function evidenceFor(rule: string): Readonly<Record<string, unknown>> {
  const evidence = (RULE_CODES as Record<string, Readonly<Record<string, unknown>>>)[rule];
  if (evidence === undefined) throw new Error(`stored rule code ${rule} is in no rule table`);
  return evidence;
}

// ---------------------------------------------------------------------------------------------
// What was quarantined (R-A21)
// ---------------------------------------------------------------------------------------------

interface StoredItem {
  readonly type: string;
  readonly scope: string;
  readonly status: string;
  readonly rule: string;
}

async function storedItems(db: Queryable): Promise<StoredItem[]> {
  const raw = await rows<{ type: string; scope: string; status: string; dedupe_key: string }>(
    db,
    sql`select type, scope, status, dedupe_key from review_items`,
  );
  return raw.map((item) => ({
    type: item.type,
    scope: item.scope,
    status: item.status,
    rule: ruleOf(item.dedupe_key),
  }));
}

const itemsWithRule = (items: readonly StoredItem[], rule: string): number =>
  items.filter((item) => item.rule === rule).length;

function group(items: readonly StoredItem[], key: (item: StoredItem) => string): Tally[] {
  return tallyOf(items.map((item) => ({ key: key(item), n: 1 })));
}

function whatWasQuarantined(items: readonly StoredItem[]): WhatWasQuarantined {
  const split = (key: string): string[] => key.split(' ');
  return {
    items: items.length,
    byStatus: group(items, (item) => item.status),
    byTypeAndScope: group(items, (item) => `${item.type} ${item.scope}`).map((entry) => {
      const [type = '', scope = ''] = split(entry.key);
      return { type, scope, items: entry.rows };
    }),
    byRule: group(items, (item) => `${item.type} ${item.scope} ${item.rule}`).map((entry) => {
      const [type = '', scope = '', rule = ''] = split(entry.key);
      return { type, scope, rule, items: entry.rows };
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// The rules applied and the assumptions under them (R-A22)
// ---------------------------------------------------------------------------------------------

/**
 * The inferences, as opposed to the deterministic conversions: every line here is a reading the
 * export does not state, tested against the whole export and reproduced by the counts beside it
 * (`CLAUDE.md` §5). Each one has a confirmation item in the queue, so a "no" identifies its rows.
 */
function rulesApplied(cleaned: WhatWasCleaned, rules: Rules, intakeWeights: number): Assumption[] {
  const rowsFor = (rule: RuleCode): number =>
    cleaned.byRule.find((applied) => applied.rule === rule)?.rows ?? 0;
  const assumption = (statement: string, rule: RuleCode): Assumption => ({
    statement,
    rule,
    rows: rowsFor(rule),
    evidence: RULE_CODES[rule],
  });
  return [
    assumption(
      'The separator says the order: `9999-99-99` is Y-M-D, `99-99-9999` D-M-Y, `99/99/9999` M-D-Y',
      'DATE_ORDER_FROM_SEPARATOR',
    ),
    assumption('The outcome spelling `OK` means approved', 'OUTCOME_OK_ASSUMED_APPROVED'),
    assumption('The questionnaire label `2.0` means v2', 'VERSION_LABEL_ASSUMED_V2'),
    assumption(
      'A weight with no unit is stored as null, never converted: reading it as pounds is a ' +
        'proposal on one vocabulary item, applied only by a human',
      'WEIGHT_UNIT_MISSING_TO_NULL',
    ),
    assumption(
      'Legacy consent times are Europe/Amsterdam wall time, converted to an instant',
      'TIMESTAMP_ZONE_ASSUMED',
    ),
    {
      statement:
        'An intake weight is in kilograms: intakes.csv carries no unit column, and the values ' +
        'sit where the patient rows in `kg` sit',
      rule: null,
      rows: intakeWeights,
      evidence: { profile: ['P-20', 'P-9'], hypothesis: 'H-2' },
    },
    {
      statement:
        'Signup weight and intake weight may legitimately differ; the divergence tolerance is ' +
        'derived from the `kg` rows and only a ratio outside it is a question',
      rule: null,
      rows: null,
      evidence: {
        tolerance: rules.weight_divergence.tolerance,
        profile: 'P-20',
        hypothesis: 'H-2',
      },
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Identity (ADR-0006, ADR-0012 item 2)
// ---------------------------------------------------------------------------------------------

async function identity(db: Queryable, items: readonly StoredItem[]): Promise<Identity> {
  // A pair a human decided is counted whether or not it is merged right now: an unmerge clears
  // `merged_into`, and the count exists so that a pair that stops merging is visible rather than
  // silent (ADR-0012 item 2).
  const humanOwned = await humanOwnedFields(db, 'patient');
  const decided = [...humanOwned.entries()]
    .filter(([, fields]) => fields.has(MERGED_INTO))
    .map(([patientId]) => patientId);
  const mergedIds = await rows<{ id: string }>(
    db,
    sql`select id from patients where merged_into is not null`,
  );
  const byTheImporter = mergedIds.filter((row) => !decided.includes(row.id)).length;
  const survivorRule = await rows<{ reason: string; pairs: number }>(
    db,
    sql`select e.reason, count(*)::int as pairs
        from audit_entries e, jsonb_array_elements(e.changes) c
        where e.actor = 'importer' and c->>'field' = ${MERGED_INTO}
        group by 1`,
  );
  // A gained field is a change on the survivor's entry, the one that records no transition. The
  // loser's entry carries one change per repointed alias row with the same `source_legacy_id`
  // marker, and those are alias rows, not fields the survivor took (ADR-0011 item 9).
  const gained = await one<{ gained: number }>(
    db,
    sql`select count(*)::int as gained
        from audit_entries e, jsonb_array_elements(e.changes) c
        where e.actor = 'importer' and e.to_state is null and c ? 'source_legacy_id'`,
  );
  const tier = (n: 2 | 3): number =>
    items.filter((item) => item.rule === `IDENTITY_TIER_${n}`).length;
  return {
    candidates: byTheImporter + decided.length + tier(2) + tier(3),
    tier1Merged: byTheImporter,
    tier2: tier(2),
    tier3: tier(3),
    tier1HumanDecided: decided.length,
    survivorRule: tallyOf(
      // The audit reason is `merged into patient <uuid>: tier-1 merge, <clause>`; the report
      // counts the clause, which is the rule, and never the uuid, which is one pair.
      survivorRule.map((row) => ({
        key: /tier-1 merge, (?<clause>.+)$/u.exec(row.reason)?.groups?.clause ?? row.reason,
        n: count(row.pairs),
      })),
    ),
    fieldsGainedFromLosers: count(gained.gained),
  };
}

// ---------------------------------------------------------------------------------------------
// Consent (ADR-0005, ADR-0011 items 13 and 22)
// ---------------------------------------------------------------------------------------------

interface LegacyRow {
  readonly id: string;
  readonly legacyId: string;
  readonly signupDate: string | null;
  readonly status: string;
  readonly mergedAway: boolean;
}

async function consent(
  db: Queryable,
  input: ReportInput,
  items: readonly StoredItem[],
): Promise<Consent> {
  // Both reads go through the typed schema rather than raw SQL: `consent_events.at` is an
  // instant, and the derivation compares instants, not the strings a text query returns.
  const legacyRows = await db
    .select({
      id: patientsTable.id,
      legacyId: patientsTable.createdFromLegacyId,
      signupDate: patientsTable.signupDate,
      status: patientsTable.status,
      mergedInto: patientsTable.mergedInto,
    })
    .from(patientsTable)
    .where(isNotNull(patientsTable.createdFromLegacyId));
  const events = await db
    .select({
      patientId: consentEventsTable.patientId,
      id: consentEventsTable.id,
      type: consentEventsTable.type,
      action: consentEventsTable.action,
      at: consentEventsTable.at,
    })
    .from(consentEventsTable)
    .where(isNotNull(consentEventsTable.patientId));
  const byPatient = new Map<string, ConsentEventInput[]>();
  for (const event of events) {
    const key = event.patientId as string;
    byPatient.set(key, [...(byPatient.get(key) ?? []), event]);
  }

  // The same pure derivation as the run's, over each legacy row's own events: a merge moves no
  // event (ADR-0011 item 3), so the row a merge took away still has exactly what it arrived with.
  const perRow = legacyRows.map((row) => ({
    row: {
      id: row.id,
      legacyId: row.legacyId ?? '',
      signupDate: row.signupDate,
      status: row.status,
      mergedAway: row.mergedInto !== null,
    } satisfies LegacyRow,
    states: deriveConsentStates({
      events: byPatient.get(row.id) ?? [],
      signupDate: row.signupDate,
      declaredTypes: input.declaredConsentTypes,
    }),
  }));
  const statesOf = (rowsToCount: typeof perRow): Tally[] =>
    tallyOf(rowsToCount.flatMap(({ states }) => states.map((s) => ({ key: s.state, n: 1 }))));

  const subjects: ConsentSubject[] = perRow.flatMap(({ row, states }) =>
    states.map((state) => ({
      legacyId: row.legacyId,
      patientId: row.id,
      status: row.status,
      type: state.type,
      state: state.state,
      signupDate: row.signupDate,
      legacyIds: [row.legacyId],
    })),
  );

  const stored = await rows<{ patient_id: string; type: string; state: string }>(
    db,
    sql`select patient_id, type, state from consent_states`,
  );
  const storedState = new Map(stored.map((row) => [`${row.patient_id}|${row.type}`, row.state]));
  const changedByMerge = perRow
    .filter(({ row }) => !row.mergedAway)
    .flatMap(({ row, states }) =>
      states.flatMap((own) => {
        const after = storedState.get(`${row.id}|${own.type}`);
        return after === undefined || after === own.state
          ? []
          : [{ key: `${own.state} -> ${after}`, n: 1 }];
      }),
    );
  const timing = await one<{
    before: number;
    patients: number;
    after: number;
    excludedIntakes: number;
    excludedPatients: number;
  }>(
    db,
    sql`with grants as (
          select patient_id, min(at) as first_grant from consent_events
          where action = 'granted' and patient_id is not null group by 1
        ),
        revocations as (
          select patient_id, max(at) as last_revoke from consent_events
          where action = 'revoked' and patient_id is not null group by 1
        ),
        still_revoked as (
          select r.patient_id, r.last_revoke from revocations r
          where not exists (
            select 1 from consent_events e where e.patient_id = r.patient_id
              and e.action = 'granted' and e.at > r.last_revoke)
        ),
        before as (
          select i.id, i.patient_id from intakes i join grants g on g.patient_id = i.patient_id
          where i.submitted_at is not null
            and i.submitted_at < (g.first_grant at time zone 'Europe/Amsterdam')::date
        )
        select (select count(*) from before)::int as before,
               (select count(distinct patient_id) from before)::int as patients,
               (select count(*) from intakes i join grants g on g.patient_id = i.patient_id
                where i.submitted_at is null)::int as "excludedIntakes",
               (select count(distinct i.patient_id) from intakes i
                join grants g on g.patient_id = i.patient_id
                where i.submitted_at is null)::int as "excludedPatients",
               (select count(*) from intakes i join still_revoked r on r.patient_id = i.patient_id
                where i.submitted_at is not null
                  and i.submitted_at > (r.last_revoke at time zone 'Europe/Amsterdam')::date
               )::int as after`,
  );
  const future = await rows<{ action: string; n: number }>(
    db,
    sql`select action, count(*)::int as n from consent_events
        where at > ${`${input.asOf}T23:59:59.999Z`}::timestamptz group by 1`,
  );

  return {
    statesPerPatient: tallyOf(stored.map((row) => ({ key: row.state, n: 1 }))),
    statesPerLegacyRow: statesOf(perRow),
    statesOfMergedAwayRows: statesOf(perRow.filter(({ row }) => row.mergedAway)),
    statesChangedByMerge: tallyOf(changedByMerge),
    itemsPerPatient: group(
      items.filter((item) => item.type === 'consent'),
      (item) => item.rule,
    ),
    itemsPerLegacyRow: tallyOf(
      consentItems(subjects).map((item) => ({ key: ruleOf(item.dedupeKey), n: 1 })),
    ),
    timing: {
      intakesBeforeFirstGrant: count(timing.before),
      patientsWithAnIntakeBeforeFirstGrant: count(timing.patients),
      intakesAfterRevocationWithNoLaterGrant: count(timing.after),
      intakesExcludedForAnUnreadableDate: count(timing.excludedIntakes),
      patientsExcludedForAnUnreadableDate: count(timing.excludedPatients),
    },
    futureDatedEvents: tallyOf(future.map((r) => ({ key: r.action, n: count(r.n) }))),
  };
}

// ---------------------------------------------------------------------------------------------
// The shadow evaluation (ADR-0005, ADR-0011 item 11, ADR-0012 item 5)
// ---------------------------------------------------------------------------------------------

async function shadowEvaluation(
  db: Queryable,
  input: ReportInput,
): Promise<ShadowEvaluationReport> {
  const cells = await rows<{ engine_outcome: string; legacy_outcome: string; n: number }>(
    db,
    sql`select e.engine_outcome, i.outcome as legacy_outcome, count(*)::int as n
        from eligibility_evaluations e join intakes i on i.id = e.intake_id
        where e.shadow group by 1, 2`,
  );
  const matrix: MatrixCell[] = cells
    .map((cell) => ({
      engineOutcome: cell.engine_outcome,
      legacyOutcome: cell.legacy_outcome,
      intakes: count(cell.n),
    }))
    .sort(
      (a, b) =>
        a.engineOutcome.localeCompare(b.engineOutcome) ||
        a.legacyOutcome.localeCompare(b.legacyOutcome),
    );
  const cell = (engine: string, legacy: string): number =>
    matrix.find((m) => m.engineOutcome === engine && m.legacyOutcome === legacy)?.intakes ?? 0;

  const stored = await rows<{ dedupe_key: string; legacy_outcome: string }>(
    db,
    sql`select dedupe_key, payload->>'legacy_outcome' as legacy_outcome
        from review_items where type = 'clinical_history'`,
  );
  const history = tallyOf(
    stored.map((row) => ({ key: `${ruleOf(row.dedupe_key)} ${row.legacy_outcome}`, n: 1 })),
  ).map((entry) => {
    const [rule = '', legacyOutcome = ''] = entry.key.split(' ');
    return { rule, legacyOutcome, intakes: entry.rows };
  });
  const unreadable = await one<{ n: number }>(
    db,
    sql`select count(*)::int as n from intakes
        where legacy_patient_id is not null and outcome = 'unknown'`,
  );
  return {
    evaluations: matrix.reduce((n, m) => n + m.intakes, 0),
    matrix,
    hardDisagreements: {
      autoRejectedWhereLegacyApproved: cell('auto_rejected', 'approved'),
      autoClearedWhereLegacyRejected: cell('auto_cleared', 'rejected'),
    },
    notEvaluable: matrix
      .filter((m) => m.engineOutcome === 'not_evaluable')
      .reduce((n, m) => n + m.intakes, 0),
    ruleHits: tally(MATCHED_RULES.map((rule) => [rule, input.ruleHits[rule] ?? 0] as const)),
    itemsRaised: history,
    unreadableOutcomeCarveOut: {
      unreadableOutcomes: count(unreadable.n),
      minorsAmongThem: history
        .filter(
          (row) => row.rule === 'HISTORY_MINOR_NOT_REJECTED' && row.legacyOutcome === 'unknown',
        )
        .reduce((n, row) => n + row.intakes, 0),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// What EXPORT-NOTES.md did not warn about (R-A23)
// ---------------------------------------------------------------------------------------------

async function notInExportNotes(
  db: Queryable,
  input: ReportInput,
  report: {
    readonly cleaned: WhatWasCleaned;
    readonly items: readonly StoredItem[];
    readonly shadow: ShadowEvaluationReport;
    readonly consent: Consent;
  },
): Promise<UnexpectedFinding[]> {
  const c = await one(
    db,
    sql`select
      (select count(*) from patients where source = 'referral')::int as "referral",
      (select count(*) from intakes
        where legacy_patient_id is not null
          and questionnaire_version_label is null)::int as "noVersionLabel",
      (select count(*) from legacy_patients_raw where signup_date like '%2062%')::int as "patients2062",
      (select count(*) from legacy_intakes_raw where submitted_at like '%2062%')::int as "intakes2062",
      (select count(*) from legacy_consent_events_raw where at like '%2062%')::int as "events2062",
      (select count(*) from (
        select bsn from patients where bsn_check = 'valid' group by bsn having count(*) > 1
       ) t)::int as "sharedBsnValues",
      (select count(*) from patients p where p.bsn_check = 'valid' and exists (
        select 1 from patients q where q.bsn = p.bsn and q.id <> p.id))::int as "sharedBsnPatients",
      (select count(*) from legacy_patients_raw
        where weight_unit = '' and weight ~ '^[0-9]+(\\.[0-9]+)?$')::int as "unitLess",
      (select count(*) filter (
        where (case when weight ~ '^[0-9]+(\\.[0-9]+)?$' then weight::numeric else 0 end) > 200)
        from legacy_patients_raw where weight_unit = '')::int as "unitLessAbove200",
      (select count(*) from intakes
        where reviewer_note ilike '%twijfel, toch akkoord%' and outcome = 'rejected')::int
        as "doubtfulRejections",
      (select count(*) from consent_events where version = 'v1'
        and (at at time zone 'Europe/Amsterdam') >= timestamp '2024-01-01')::int as "v1Stragglers",
      (select count(*) from consent_events
        where (at at time zone 'Europe/Amsterdam') < timestamp '2023-01-01')::int as "before2023",
      (select count(*) from patients p where p.created_from_legacy_id is not null
        and exists (select 1 from consent_events e where e.patient_id = p.id)
        and not exists (
          select 1 from consent_events e where e.patient_id = p.id
            and (e.at at time zone 'Europe/Amsterdam') >= timestamp '2023-01-01'))::int
        as "noEventSince2023",
      (select count(*) from (
        select patient_id from consent_events where patient_id is not null and source_line is not null
        group by patient_id
        having array_agg(source_line order by at, source_line) <> array_agg(source_line order by source_line)
       ) t)::int as "outOfFileOrder"`,
  );
  const cleanedRows = (rule: RuleCode): number =>
    report.cleaned.byRule.find((applied) => applied.rule === rule)?.rows ?? 0;
  const historyItems = (rule: string): number =>
    report.shadow.itemsRaised
      .filter((item) => item.rule === rule)
      .reduce((n, item) => n + item.intakes, 0);
  const historyItemsWithOutcome = (rule: string, outcome: string): number =>
    report.shadow.itemsRaised
      .filter((item) => item.rule === rule && item.legacyOutcome === outcome)
      .reduce((n, item) => n + item.intakes, 0);
  const minors = report.shadow.ruleHits.find((hit) => hit.key === 'age_below_minimum')?.rows ?? 0;
  const consentState = (state: string): number =>
    report.consent.statesPerLegacyRow.find((entry) => entry.key === state)?.rows ?? 0;
  const future = report.consent.futureDatedEvents;
  const futureTotal = future.reduce((n, entry) => n + entry.rows, 0);

  return [
    {
      finding: '`source` carries a sixth funnel the notes do not name: `referral`',
      numbers: { patients: count(c.referral) },
      evidence: 'P-14',
      notCovered: 'the notes list `typeform`, `website`, campaign tags and `import` and stop there',
    },
    {
      finding:
        '`OK` is not a spelling of approved but an inference over medical decisions; it has its ' +
        'own rule code and a confirmation item, so a "no" identifies every row to remap',
      numbers: { intakes: cleanedRows('OUTCOME_OK_ASSUMED_APPROVED') },
      evidence: 'P-25',
      notCovered: 'the notes say outcomes are "spelled many ways", which `OK` is not',
    },
    {
      finding:
        'Intakes with no questionnaire label at all: the ruleset that evaluated them is not ' +
        'recorded anywhere, and `2.0` sits beside `v2` with nothing to tell them apart',
      numbers: {
        intakesWithNoLabel: count(c.noVersionLabel),
        intakesLabelled2Point0: cleanedRows('VERSION_LABEL_ASSUMED_V2'),
      },
      evidence: 'P-19',
      notCovered: 'the notes say only that "labelling discipline varied"',
    },
    {
      finding:
        'Three patient records are shifted about 36 years into the future, consistently across ' +
        'all three files; their dates of birth are normal, so it is the row that moved, not a digit',
      numbers: {
        patientRows: count(c.patients2062),
        intakeRows: count(c.intakes2062),
        consentEvents: count(c.events2062),
      },
      evidence: 'P-13, P-18, P-31',
      notCovered: 'the notes warn about date *ordering*, not about dates that are impossible',
    },
    {
      finding: `Consent events dated after the run's --as-of (${input.asOf}), revocations included`,
      numbers: Object.fromEntries([
        ['events', futureTotal],
        ...future.map((entry) => [entry.key, entry.rows] as const),
      ]),
      evidence: 'P-31',
      notCovered: 'the notes question the log only *before* 2023',
    },
    {
      finding:
        'Valid BSNs carried by more than one patient row: an identity collision on a national ' +
        'identifier, not a formatting problem',
      numbers: {
        bsnValues: count(c.sharedBsnValues),
        patients: count(c.sharedBsnPatients),
      },
      evidence: 'P-6, P-34',
      notCovered: 'the notes say BSNs were "never validated", which is a claim about their shape',
    },
    {
      finding:
        'The weights left without a unit are not a leftover: read as kilograms most are outside ' +
        'any plausible adult range, read as pounds they are ordinary. Stored null, asked once',
      numbers: {
        patients: count(c.unitLess),
        above200AsKilograms: count(c.unitLessAbove200),
      },
      evidence: 'P-10, H-2',
      notCovered: 'the notes promise the unit was backfilled "where obvious" and say no more',
    },
    {
      finding:
        'Free-text history names contraindications on intakes the legacy process approved: ' +
        'GLP-1 medication, and thyroid cancer or pancreatitis',
      numbers: {
        glp1Intakes: historyItems('HISTORY_GLP1_MEDICATION'),
        glp1Approved: historyItemsWithOutcome('HISTORY_GLP1_MEDICATION', 'approved'),
        flagConditionIntakes: historyItems('HISTORY_FLAG_CONDITION'),
        flagConditionApproved: historyItemsWithOutcome('HISTORY_FLAG_CONDITION', 'approved'),
      },
      evidence: 'P-22, P-23',
      notCovered:
        'the notes describe both columns as free text that was never normalised, and say ' +
        'nothing about what is in them',
    },
    {
      finding:
        'Intakes from patients under 18 at submission, most of them not rejected — a legal ' +
        'question rather than a disagreement about the rules',
      numbers: {
        intakes: minors,
        approvedOrPending: historyItems('HISTORY_MINOR_NOT_REJECTED'),
        rejected: minors - historyItems('HISTORY_MINOR_NOT_REJECTED'),
      },
      evidence: 'P-4, H-1',
      notCovered: 'the notes say nothing about age',
    },
    {
      finding: 'One patient submitting two intakes on one day, which no rule in the export forbids',
      numbers: { pairs: report.items.filter((item) => item.rule === 'SAME_DAY_INTAKES').length },
      evidence: 'P-27',
      notCovered:
        'the notes warn about people signing up twice, which is a duplicate *patient*, not a ' +
        'duplicate submission',
    },
    {
      finding:
        'The consent log is not in time order: read as an append-only file, last line wins, it ' +
        'reports a different state for these patients than their timestamps do',
      numbers: { patients: count(c.outOfFileOrder) },
      evidence: 'P-33',
      notCovered: 'the notes call the file append-only, which is what makes the order look safe',
    },
    {
      finding:
        'Patients with no consent event at all, and `v1` consent-text versions still appearing ' +
        'after the `v2` cut-over: silence before 2023 cannot be told from a lost record',
      numbers: {
        patientsWithNoRecord: consentState('no_record') + consentState('unknown_pre_log'),
        eventsBefore2023: count(c.before2023),
        patientsWithNoEventSince2023: count(c.noEventSince2023),
        eventsStillLabelledV1After2024: count(c.v1Stragglers),
      },
      evidence: 'P-30, P-31, P-32',
      notCovered:
        'the notes say the log is "believed complete from 2023 onwards" and leave the rest open',
    },
    {
      finding:
        'A reviewer note saying "twijfel, toch akkoord" ("doubt, approved anyway") on intakes ' +
        'whose recorded outcome is a rejection: the note and the outcome disagree',
      numbers: { intakes: count(c.doubtfulRejections) },
      evidence: 'P-26',
      notCovered: 'the notes describe `reviewer_note` as free text and nothing more',
    },
  ];
}

// ---------------------------------------------------------------------------------------------

export async function buildReport(db: Queryable, input: ReportInput): Promise<ImportReport> {
  const items = await storedItems(db);
  const cleaned = await whatWasCleaned(db);
  const intakeWeights = await one<{ n: number }>(
    db,
    sql`select count(*)::int as n from intakes
        where legacy_patient_id is not null and weight_kg is not null`,
  );
  const shadow = await shadowEvaluation(db, input);
  const consentReport = await consent(db, input, items);
  return {
    asOf: input.asOf,
    importerVersion: IMPORTER_VERSION,
    rulesetVersion: input.rules.version,
    whatCameIn: await whatCameIn(db, input, items),
    whatWasCleaned: cleaned,
    whatWasQuarantined: whatWasQuarantined(items),
    rulesApplied: rulesApplied(cleaned, input.rules, count(intakeWeights.n)),
    identity: await identity(db, items),
    consent: consentReport,
    shadowEvaluation: shadow,
    notInExportNotes: await notInExportNotes(db, input, {
      cleaned,
      items,
      shadow,
      consent: consentReport,
    }),
  };
}
