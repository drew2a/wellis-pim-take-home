// The import report against the database it describes (R-A18 to R-A23, ADR-0011 item 14):
// every number in it equals the corresponding count, two runs render byte-identical files, and
// the one figure that is not a `SELECT` — the per-rule hits, which the engine reports because no
// column stores them — is cross-checked here against the reason lines the engine stored.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadRules } from '@/rules/load';
import { createTestDatabase, type TestDatabase } from '@/test/database';

import { runImport, type ImportSummary } from '../run';
import { recordReportPath } from '../runs';
import { renderJson } from './files';
import { renderMarkdown } from './render';
import type { ImportReport, Tally } from './types';

const options = {
  exportDir: 'legacy_export',
  asOf: '2026-09-08',
  dryRun: false,
  rules: loadRules(),
};

const rowsOf = (entries: readonly Tally[], key: string): number =>
  entries.find((entry) => entry.key === key)?.rows ?? 0;

const sum = (entries: readonly Tally[]): number => entries.reduce((n, entry) => n + entry.rows, 0);

describe('the import report', () => {
  let database: TestDatabase;
  let summary: ImportSummary;
  let report: ImportReport;

  beforeAll(async () => {
    database = await createTestDatabase();
    await database.migrate();
    summary = await runImport(database.db, options);
    report = summary.report;
  });

  afterAll(async () => {
    await (database as TestDatabase | undefined)?.drop();
  });

  async function scalar(query: Promise<{ n: string }[]>): Promise<number> {
    const [row] = await query;
    return Number(row?.n);
  }

  it('states the inputs every number depends on, and nothing about the run', () => {
    expect(report.asOf).toBe('2026-09-08');
    expect(report.importerVersion).toBe(summary.importerVersion);
    expect(report.rulesetVersion).toBe(options.rules.version);
    const serialised = renderJson(report);
    expect(serialised).not.toContain(`"runId"`);
    expect(serialised).not.toMatch(/\d{4}-\d\d-\d\dT\d\d:\d\d/u);
    // The files are named with the sha256 and byte count the run stored for them.
    expect(report.whatCameIn.files.map((file) => file.name)).toEqual([
      'patients.csv',
      'intakes.csv',
      'consents.jsonl',
    ]);
    for (const file of report.whatCameIn.files) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(file.bytes).toBeGreaterThan(0);
    }
  });

  it('counts what came in, and every count is the table count', async () => {
    const came = report.whatCameIn;
    for (const table of [
      'legacy_patients_raw',
      'legacy_intakes_raw',
      'legacy_consent_events_raw',
    ]) {
      const stored = await scalar(
        database.sql<{ n: string }[]>`select count(*)::text as n from ${database.sql(table)}`,
      );
      expect(rowsOf(came.rawRows, table)).toBe(stored);
    }
    expect(rowsOf(came.rawRows, 'legacy_patients_raw')).toBe(2466);
    expect(rowsOf(came.rawRows, 'legacy_intakes_raw')).toBe(2917);
    expect(rowsOf(came.rawRows, 'legacy_consent_events_raw')).toBe(2643);

    expect(came.patients.legacyRows).toBe(2466);
    expect(came.patients.surviving).toBe(
      await scalar(
        database.sql`select count(*)::text as n from patients where merged_into is null`,
      ),
    );
    expect(came.patients.mergedAway).toBe(
      await scalar(
        database.sql`select count(*)::text as n from patients where merged_into is not null`,
      ),
    );
    // Nothing is dropped by a merge: every legacy id still resolves to exactly one patient.
    expect(came.patients.legacyIdsResolving).toBe(2466);
    expect(came.intakes.rows).toBe(2917);
    expect(came.intakes.orphans).toBe(summary.canonical.intakes.orphans);
    expect(came.consentEvents.rows).toBe(2643);
    expect(came.consentEvents.withoutPatient).toBe(0);
    expect(came.repeatedKeys).toBe(0);
    expect(came.changedSinceEarlierRun).toBe(0);
  });

  it('counts what was cleaned per rule and per field, as normalisation_records holds it', async () => {
    const cleaned = report.whatWasCleaned;
    expect(cleaned.records).toBe(
      await scalar(database.sql`select count(*)::text as n from normalisation_records`),
    );
    const stored = await database.sql<{ rule: string; field: string; n: string }[]>`
      select rule_code as rule, field, count(*)::text as n
      from normalisation_records group by 1, 2 order by 1, 2
    `;
    const perField = new Map(stored.map((row) => [`${row.rule}:${row.field}`, Number(row.n)]));
    expect(perField.size).toBeGreaterThan(0);
    for (const rule of cleaned.byRule) {
      for (const field of rule.fields) {
        expect(perField.get(`${rule.rule}:${field.key}`)).toBe(field.rows);
      }
      expect(rule.rows).toBe(sum(rule.fields));
      expect(rule.blanked).toBe(
        await scalar(
          database.sql`select count(*)::text as n from normalisation_records
            where rule_code = ${rule.rule} and to_value is null`,
        ),
      );
      // Every rule states the evidence it rests on (R-A22).
      expect(Object.keys(rule.evidence).length).toBeGreaterThan(0);
    }
    // The same figures the summary prints, from the other side of the write.
    expect(Object.fromEntries(cleaned.byRule.map((rule) => [rule.rule, rule.rows]))).toEqual(
      summary.rulesApplied,
    );
    expect(cleaned.daylightSaving).toEqual(summary.consentTime);
  });

  it('counts what was quarantined by type, scope and rule', async () => {
    const quarantined = report.whatWasQuarantined;
    expect(quarantined.items).toBe(
      await scalar(database.sql`select count(*)::text as n from review_items`),
    );
    const stored = await database.sql<{ key: string; n: string }[]>`
      select type || '/' || scope as key, count(*)::text as n from review_items group by 1
    `;
    const byTypeAndScope = Object.fromEntries(
      quarantined.byTypeAndScope.map((entry) => [`${entry.type}/${entry.scope}`, entry.items]),
    );
    expect(byTypeAndScope).toEqual(Object.fromEntries(stored.map((r) => [r.key, Number(r.n)])));
    expect(byTypeAndScope).toEqual(summary.reviewItems);
    // Grouping by rule is a partition of the same items, no item counted twice or lost.
    expect(quarantined.byRule.reduce((n, entry) => n + entry.items, 0)).toBe(quarantined.items);
    expect(sum(quarantined.byStatus)).toBe(quarantined.items);
    expect(rowsOf(quarantined.byStatus, 'open')).toBe(quarantined.items);
  });

  it('names the identity tiers and what the importer did with them', async () => {
    const identity = report.identity;
    expect(identity.tier1Merged).toBe(
      await scalar(
        database.sql`select count(*)::text as n from patients where merged_into is not null`,
      ),
    );
    expect({
      candidates: identity.candidates,
      tier1: identity.tier1Merged,
      tier2: identity.tier2,
      tier3: identity.tier3,
      humanDecided: identity.tier1HumanDecided,
    }).toEqual({
      candidates: summary.identity.groups,
      tier1: summary.identity.tier1,
      tier2: summary.identity.tier2,
      tier3: summary.identity.tier3,
      humanDecided: summary.identity.humanDecided,
    });
    expect(identity.fieldsGainedFromLosers).toBe(summary.identity.gainedFields);
    // One survivor clause per merged pair, from the merge's own audit entry.
    expect(sum(identity.survivorRule)).toBe(identity.tier1Merged);
    // The group sizes are a partition of the same groups over the same rows, so "every one of
    // them a pair" is a figure the report carries rather than a sentence the renderer asserts.
    expect(sum(identity.groupSizes)).toBe(identity.candidates);
    expect(identity.groupSizes.reduce((n, entry) => n + Number(entry.key) * entry.rows, 0)).toBe(
      summary.identity.rows,
    );
    expect(identity.groupSizes).toEqual([{ key: '2', rows: 70 }]);
  });

  it('counts consent states twice — per patient and per legacy row — and explains the difference', async () => {
    const consent = report.consent;
    const stored = await database.sql<{ state: string; n: string }[]>`
      select state, count(*)::text as n from consent_states group by 1
    `;
    expect(Object.fromEntries(consent.statesPerPatient.map((e) => [e.key, e.rows]))).toEqual(
      Object.fromEntries(stored.map((r) => [r.state, Number(r.n)])),
    );
    expect(sum(consent.statesPerPatient)).toBe(summary.consentStatesWritten);
    // ADR-0005's counts are over the 2466 legacy rows; ADR-0011 item 13 asks for both.
    expect(sum(consent.statesPerLegacyRow)).toBe(2466);
    expect(Object.fromEntries(consent.statesPerLegacyRow.map((e) => [e.key, e.rows]))).toEqual({
      granted: 2091,
      revoked: 269,
      conflict: 7,
      no_record: 74,
      unknown_pre_log: 25,
    });
    // The two tables differ by exactly two things, and they account for it to the row: the rows
    // a merge took away, and the survivors whose state changed because the merge handed them
    // their duplicate's events (ADR-0011 item 3: a merge moves no event).
    expect(sum(consent.statesOfMergedAwayRows)).toBe(report.whatCameIn.patients.mergedAway);
    const moved = (from: string, to: string): number =>
      rowsOf(consent.statesChangedByMerge, `${from} -> ${to}`);
    const states = [...new Set(consent.statesPerLegacyRow.map((entry) => entry.key))];
    for (const state of states) {
      const left = states.reduce((n, other) => n + moved(state, other), 0);
      const arrived = states.reduce((n, other) => n + moved(other, state), 0);
      expect(rowsOf(consent.statesPerLegacyRow, state)).toBe(
        rowsOf(consent.statesPerPatient, state) +
          rowsOf(consent.statesOfMergedAwayRows, state) +
          left -
          arrived,
      );
    }
    // The duplicate carried the consent record for these patients, which is why a merge is not
    // only tidiness: no survivor loses a state, and some gain one.
    expect(sum(consent.statesChangedByMerge)).toBeGreaterThan(0);
    expect(
      consent.statesChangedByMerge.every(
        (entry) =>
          entry.key.startsWith('no_record -> ') || entry.key.startsWith('unknown_pre_log -> '),
      ),
    ).toBe(true);
    // The items in the queue are the per-patient reading; the per-row reading is ADR-0005's 99.
    expect(sum(consent.itemsPerPatient)).toBe(
      await scalar(
        database.sql`select count(*)::text as n from review_items where type = 'consent'`,
      ),
    );
    expect(sum(consent.itemsPerLegacyRow)).toBe(99);
    expect(rowsOf(consent.itemsPerLegacyRow, 'CONSENT_CONFLICT')).toBe(7);
    expect(rowsOf(consent.itemsPerLegacyRow, 'CONSENT_REVOKED_WHILE_ACTIVE')).toBe(19);
    expect(rowsOf(consent.itemsPerLegacyRow, 'CONSENT_NO_RECORD_WHILE_ACTIVE')).toBe(73);
    expect(sum(consent.futureDatedEvents)).toBe(
      await scalar(
        database.sql`select count(*)::text as n from consent_events
          where at > '2026-09-08T23:59:59.999Z'::timestamptz`,
      ),
    );
  });

  it('reports the medical record against the consent log with a stated definition', async () => {
    const timing = report.consent.timing;
    // An intake dated strictly before the calendar day of the patient's first grant, and one
    // dated strictly after the day of a revocation that no later grant undoes.
    expect(timing.intakesBeforeFirstGrant).toBe(
      await scalar(database.sql`
        with grants as (
          select patient_id, min(at) as first_grant from consent_events
          where action = 'granted' and patient_id is not null group by 1
        )
        select count(*)::text as n from intakes i join grants g on g.patient_id = i.patient_id
        where i.submitted_at is not null
          and i.submitted_at < (g.first_grant at time zone 'Europe/Amsterdam')::date
      `),
    );
    expect(timing.patientsWithAnIntakeBeforeFirstGrant).toBeLessThanOrEqual(
      timing.intakesBeforeFirstGrant,
    );
    // ADR-0005 carries 71 intakes over 70 patients, read off the raw dates in the profiling
    // session. The canonical comparison cannot see the three intakes whose submission date the
    // mapper nulled as impossible, and those three belong to two patients: 68 + 3 and 68 + 2.
    expect(timing.intakesBeforeFirstGrant + timing.intakesExcludedForAnUnreadableDate).toBe(71);
    expect(
      timing.patientsWithAnIntakeBeforeFirstGrant + timing.patientsExcludedForAnUnreadableDate,
    ).toBe(70);
    // Over both comparison populations, not the grant side alone: an intake whose patient has a
    // revocation and no grant belongs to the second figure, and a count that joined `grants`
    // would leave it out of the figure and out of the exclusion that explains the figure.
    expect(timing.intakesExcludedForAnUnreadableDate).toBe(
      await scalar(database.sql`
        select count(*)::text as n from intakes i
        where i.legacy_patient_id is not null and i.submitted_at is null and exists (
          select 1 from consent_events e
          where e.patient_id = i.patient_id and e.source_line is not null)
      `),
    );
    // ADR-0005 carries 83 for the second figure, from the profiling session, and it reproduces.
    expect(timing.intakesAfterRevocationWithNoLaterGrant).toBe(83);
    expect(timing.intakesAfterRevocationWithNoLaterGrant).toBe(
      await scalar(database.sql`
        with revocations as (
          select patient_id, max(at) as last_revoke from consent_events
          where action = 'revoked' and patient_id is not null group by 1
        )
        select count(*)::text as n from intakes i join revocations r on r.patient_id = i.patient_id
        where i.submitted_at is not null
          and i.submitted_at > (r.last_revoke at time zone 'Europe/Amsterdam')::date
          and not exists (select 1 from consent_events e where e.patient_id = r.patient_id
            and e.action = 'granted' and e.at > r.last_revoke)
      `),
    );
  });

  it('states the whole 4x3 matrix and calls exactly two cells a disagreement', async () => {
    const shadow = report.shadowEvaluation;
    expect(shadow.evaluations).toBe(
      await scalar(
        database.sql`select count(*)::text as n from eligibility_evaluations where shadow`,
      ),
    );
    expect(shadow.evaluations).toBe(2917);
    for (const cell of shadow.matrix) {
      expect(cell.intakes).toBe(
        await scalar(database.sql`
          select count(*)::text as n from eligibility_evaluations e join intakes i on i.id = e.intake_id
          where e.shadow and e.engine_outcome::text = ${cell.engineOutcome}
            and i.outcome::text = ${cell.legacyOutcome}
        `),
      );
    }
    expect(shadow.hardDisagreements.autoRejectedWhereLegacyApproved).toBe(
      shadow.matrix.find(
        (cell) => cell.engineOutcome === 'auto_rejected' && cell.legacyOutcome === 'approved',
      )?.intakes,
    );
    expect(shadow.hardDisagreements.autoClearedWhereLegacyRejected).toBe(
      shadow.matrix.find(
        (cell) => cell.engineOutcome === 'auto_cleared' && cell.legacyOutcome === 'rejected',
      )?.intakes,
    );
    expect(shadow.notEvaluable).toBe(summary.shadow.outcomes.not_evaluable);
    // The carve-out of ADR-0012 item 5, and what it covers in this export.
    expect(shadow.unreadableOutcomeCarveOut.unreadableOutcomes).toBe(
      await scalar(database.sql`select count(*)::text as n from intakes where outcome = 'unknown'`),
    );
    // ADR-0012 item 5 guards a case this export does not contain: every outcome spelling in it
    // is one the mapping table knows, so there is no `unknown` outcome and no minor behind one.
    expect(shadow.unreadableOutcomeCarveOut.unreadableOutcomes).toBe(0);
    expect(shadow.unreadableOutcomeCarveOut.minorsAmongThem).toBe(0);
  });

  // The one figure no column holds: the engine says which rules fired (ADR-0011 item 21). It is
  // checked here against the reason lines the same evaluations stored, which is a second reading
  // of the engine's own output and belongs in a test rather than in the report.
  it('reports the rules that would fire today, and the stored reasons agree', async () => {
    const shadow = report.shadowEvaluation;
    expect(Object.fromEntries(shadow.ruleHits.map((hit) => [hit.key, hit.rows]))).toEqual({
      age_below_minimum: 70,
      bmi_below_minimum: 191,
      bmi_band_without_condition: 283,
      glp1_medication: 42,
      flag_condition: 15,
    });
    const reasons = await database.sql<{ rule: string; n: string }[]>`
      select rule, count(*)::text as n from (
        select case
          when exists (select 1 from jsonb_array_elements_text(reasons) r
                       where r.value like 'rejected: age %') then 'age_below_minimum'
        end as rule from eligibility_evaluations where shadow
        union all
        select case
          when exists (select 1 from jsonb_array_elements_text(reasons) r
                       where r.value like 'rejected: BMI %') then 'bmi_below_minimum'
        end from eligibility_evaluations where shadow
        union all
        select case
          when exists (select 1 from jsonb_array_elements_text(reasons) r
                       where r.value like 'flagged: BMI % with no weight-related condition')
            then 'bmi_band_without_condition'
        end from eligibility_evaluations where shadow
        union all
        select case
          when exists (select 1 from jsonb_array_elements_text(reasons) r
                       where r.value like 'flagged: current GLP-1 medication%') then 'glp1_medication'
        end from eligibility_evaluations where shadow
        union all
        select case
          when exists (select 1 from jsonb_array_elements_text(reasons) r
                       where r.value like 'flagged: self-reported history of%') then 'flag_condition'
        end from eligibility_evaluations where shadow
      ) t where rule is not null group by 1
    `;
    expect(Object.fromEntries(reasons.map((row) => [row.rule, Number(row.n)]))).toEqual(
      Object.fromEntries(shadow.ruleHits.map((hit) => [hit.key, hit.rows])),
    );
  });

  it('states what EXPORT-NOTES.md did not warn about, with a count and its evidence', () => {
    const findings = report.notInExportNotes;
    expect(findings.length).toBeGreaterThanOrEqual(10);
    for (const found of findings) {
      expect(found.evidence).toMatch(/[PH]-\d+/u);
      expect(found.notCovered.length).toBeGreaterThan(0);
      expect(Object.keys(found.numbers).length).toBeGreaterThan(0);
      for (const value of Object.values(found.numbers)) {
        expect(Number.isInteger(value)).toBe(true);
      }
    }
    // Each of the ten the brief's reviewers would look for is present and not zero.
    const all = JSON.stringify(findings);
    for (const subject of [
      'referral',
      '`OK`',
      'questionnaire label',
      'dated in 2062',
      'dated after',
      'Valid BSNs',
      'without a unit',
      'GLP-1',
      'under 18',
      'two intakes on one day',
    ]) {
      expect(all).toContain(subject);
    }
    // Nothing in this section is a zero: a finding with no rows behind it is not a finding.
    for (const found of findings) {
      for (const [key, value] of Object.entries(found.numbers)) {
        expect([key, value > 0]).toEqual([key, true]);
      }
    }
  });

  // Two findings the review caught claiming more than the data says: a shared BSN the importer had
  // already resolved counted as an open collision, and a cut-over date typed into the query.
  it('separates the shared BSNs the importer resolved from the ones still open', async () => {
    const found = report.notInExportNotes.find((entry) => entry.finding.startsWith('Valid BSNs'));
    const numbers = found?.numbers ?? {};
    expect(numbers.bsnValues).toBe(
      await scalar(database.sql`
        select count(*)::text as n from (
          select bsn from patients
          where created_from_legacy_id is not null and bsn_check = 'valid'
          group by bsn having count(*) > 1) t
      `),
    );
    // The open half counts surviving rows only; a pair the importer merged is one patient now.
    expect(numbers.valuesStillOnMoreThanOneSurvivingPatient).toBe(
      await scalar(database.sql`
        select count(*)::text as n from (
          select bsn from patients
          where created_from_legacy_id is not null and bsn_check = 'valid' and merged_into is null
          group by bsn having count(*) > 1) t
      `),
    );
    expect(numbers.bsnValues).toBe(
      (numbers.valuesStillOnMoreThanOneSurvivingPatient ?? 0) +
        (numbers.valuesResolvedByTier1Merge ?? 0),
    );
    expect(numbers.valuesResolvedByTier1Merge).toBeGreaterThan(0);
  });

  it('reads the v2 cut-over off the log instead of naming a date', async () => {
    const found = report.notInExportNotes.find((entry) =>
      entry.finding.startsWith('Patients with'),
    );
    const cutOver = await database.sql<{ at: string }[]>`
      select to_char(min(at) at time zone 'Europe/Amsterdam', 'YYYY-MM-DD') as at
      from consent_events where version = 'v2' and source_line is not null
    `;
    expect(found?.finding).toContain(`(${cutOver[0]?.at})`);
    expect(found?.numbers.eventsStillLabelledV1AfterIt).toBe(
      await scalar(database.sql`
        select count(*)::text as n from consent_events
        where version = 'v1' and source_line is not null and at >= (
          select min(at) from consent_events where version = 'v2' and source_line is not null)
      `),
    );
  });

  it('renders byte-identical files on a second run over the same export (R-A15)', async () => {
    const second = await runImport(database.db, options);

    expect(renderJson(second.report)).toBe(renderJson(report));
    expect(renderMarkdown(second.report)).toBe(renderMarkdown(report));
    // And the Markdown is a function of the JSON alone: same JSON, same Markdown.
    expect(renderMarkdown(JSON.parse(renderJson(report)) as ImportReport)).toBe(
      renderMarkdown(report),
    );
  });

  it('records the path of the file it wrote on the run that wrote it', async () => {
    await recordReportPath(database.db, summary.runId, 'reports/import-report.json');

    const [run] = await database.sql<{ report_path: string | null }[]>`
      select report_path from import_runs where id = ${summary.runId}
    `;
    expect(run?.report_path).toBe('reports/import-report.json');
  });
});
