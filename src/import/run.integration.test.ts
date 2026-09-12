// The importer end to end (R-A14 to R-A17, ADR-0004, ADR-0008, ADR-0009): one run loads the
// export with every record and item, a second run changes no table but import_runs, a dry run
// changes only import_runs, a changed source row and a human-owned field raise items once.
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { auditEntries, importRuns, patients, reviewItems } from '@/db/schema';
import { loadRules } from '@/rules/load';
import { createTestDatabase, type TestDatabase } from '@/test/database';

import { runImport, type ImportSummary } from './run';

const rules = loadRules();
const options = { exportDir: 'legacy_export', asOf: '2026-09-08', dryRun: false, rules };

const TABLES = [
  'import_runs',
  'legacy_patients_raw',
  'legacy_intakes_raw',
  'legacy_consent_events_raw',
  'patients',
  'patient_legacy_ids',
  'intakes',
  'consent_events',
  'consent_states',
  'eligibility_evaluations',
  'normalisation_records',
  'review_items',
  'audit_entries',
] as const;

type Table = (typeof TABLES)[number];

describe('npm run import', () => {
  let database: TestDatabase;
  let first: ImportSummary;

  beforeAll(async () => {
    database = await createTestDatabase();
    await database.migrate();
    first = await runImport(database.db, options);
  });

  afterAll(async () => {
    await (database as TestDatabase | undefined)?.drop();
  });

  async function counts(): Promise<Record<Table, number>> {
    const out = {} as Record<Table, number>;
    for (const table of TABLES) {
      const [row] = await database.sql<
        { n: string }[]
      >`select count(*)::text as n from ${database.sql(table)}`;
      out[table] = Number(row?.n);
    }
    return out;
  }

  async function ruleCounts(): Promise<Record<string, number>> {
    const rows = await database.sql<{ key: string; n: string }[]>`
      select field || ':' || rule_code as key, count(*)::text as n
      from normalisation_records group by 1 order by 1
    `;
    return Object.fromEntries(rows.map((r) => [r.key, Number(r.n)]));
  }

  async function itemCounts(): Promise<Record<string, number>> {
    const rows = await database.sql<{ key: string; n: string }[]>`
      select type || '/' || scope as key, count(*)::text as n from review_items group by 1 order by 1
    `;
    return Object.fromEntries(rows.map((r) => [r.key, Number(r.n)]));
  }

  it('loads the export with the counts of ADR-0004 and the rules of ADR-0005', async () => {
    expect(first.raw).toEqual({
      legacy_patients_raw: { inserted: 2466, unchanged: 0, changed: 0, repeated: 0 },
      legacy_intakes_raw: { inserted: 2917, unchanged: 0, changed: 0, repeated: 0 },
      legacy_consent_events_raw: { inserted: 2643, unchanged: 0, changed: 0, repeated: 0 },
    });
    expect(first.canonical).toEqual({
      patients: { inserted: 2466, updated: 0 },
      intakes: { inserted: 2917, updated: 0, orphans: 21, auditEntriesInserted: 2917 },
      consentEvents: { inserted: 2643, skipped: 0 },
    });
    expect(first.consentTime).toEqual({ ambiguous: 0, nonexistent: 0 });
    expect(first.humanOwnedConflicts).toBe(0);

    expect(first.rulesApplied).toEqual({
      WHITESPACE_TRIM: 102,
      EMAIL_LOWERCASE: 28,
      EMAIL_PLACEHOLDER_TO_NULL: 11,
      EMAIL_INTERNAL_SPACE_TO_NULL: 10,
      DATE_ORDER_FROM_SEPARATOR: 638 + 647 + 413,
      DATE_IMPOSSIBLE_TO_NULL: 5 + 3 + 3,
      VOCAB_SEX: 1976,
      PHONE_E164_NL_MOBILE: 1259,
      WEIGHT_LBS_TO_KG: 55,
      WEIGHT_UNIT_MISSING_TO_NULL: 18,
      IMPLAUSIBLE_TO_NULL: 5 + 5 + 6 + 6,
      VOCAB_STATUS: 1917,
      VERSION_LABEL_ASSUMED_V2: 394,
      VOCAB_NONE_MEDICATION: 815,
      VOCAB_NONE_CONDITION: 348,
      NON_NUMERIC_TO_NULL: 272,
      VOCAB_OUTCOME: 1836,
      OUTCOME_OK_ASSUMED_APPROVED: 441,
      TIMESTAMP_ZONE_ASSUMED: 2643,
    });
    // The database agrees with the mapper, per field.
    const stored = await ruleCounts();
    expect(stored).toEqual(first.rulesByField);
    expect(stored['dob:DATE_ORDER_FROM_SEPARATOR']).toBe(638);
    expect(stored['signup_date:DATE_ORDER_FROM_SEPARATOR']).toBe(647);
    expect(stored['submitted_at:DATE_ORDER_FROM_SEPARATOR']).toBe(413);
    expect(first.recordsInserted).toBe(
      Object.values(first.rulesApplied).reduce((a, b) => a + b, 0),
    );

    expect(first.reviewItems).toEqual({
      // The mapping's 52, plus the 10 plausibility items ADR-0009 item 2 owed. The weight
      // divergence detector adds none over this export (ADR-0011 item 19).
      'data_quality/row': 11 + 10 + 5 + 17 + 6 + 3 + 10,
      'orphan_intake/row': 21,
      // The mapping's 5, plus the unit-less weights, the lbs non-reconciliation and the
      // future-dated consent events.
      'vocabulary/vocabulary': 5 + 3,
      'identity_conflict/row': 3 + 39,
      'duplicate_intake/row': 5,
      'consent/row': 83,
      'clinical_history/row': 42 + 15 + 58,
    });
    expect(first.reviewItemsInserted).toBe(62 + 21 + 8 + 42 + 5 + 83 + 115);
    expect(await itemCounts()).toEqual(first.reviewItems);
  });

  // ADR-0005's consent items, over the surviving patients rather than the legacy rows.
  it('raises a consent item only where the state and the status cannot both be right', async () => {
    const rows = await database.sql<{ title: string; n: string }[]>`
      select title, count(*)::text as n from review_items where type = 'consent'
      group by 1 order by 1
    `;
    const byTitle = Object.fromEntries(rows.map((r) => [r.title, Number(r.n)]));

    expect(byTitle['consent log contradicts itself']).toBe(7);
    expect(byTitle['consent revoked while the patient is active']).toBe(19);
    // ADR-0005 counts 73 patients without a record whose status is active or paused, over the
    // 2466 legacy rows; 16 of them are duplicate rows this run merged away, and a merged row is
    // not a second person to chase for consent.
    const noRecord = Object.entries(byTitle)
      .filter(([title]) => title.startsWith('no consent record'))
      .reduce((n, [, count]) => n + count, 0);
    expect(noRecord).toBe(73 - 16);

    // Churned and prospect patients raise none: there is nothing to stop.
    const [wrongStatus] = await database.sql<{ n: string }[]>`
      select count(*)::text as n from review_items i join patients p on p.id = i.patient_id
      where i.type = 'consent' and p.status in ('churned', 'prospect')
        and i.title not like 'consent log contradicts%'
    `;
    expect(Number(wrongStatus?.n)).toBe(0);
  });

  // ADR-0005: every legacy intake gets a shadow evaluation and no legacy state changes.
  it('evaluates every legacy intake in shadow and applies nothing', async () => {
    expect(first.shadow.evaluated).toBe(2917);
    expect(first.shadow.written).toBe(2917);
    expect(first.shadow.ruleHits).toEqual({
      age_below_minimum: 70,
      bmi_below_minimum: 191,
      bmi_band_without_condition: 283,
      glp1_medication: 42,
      flag_condition: 15,
    });

    const [stored] = await database.sql<{ n: string; shadow: string }[]>`
      select count(*)::text as n, count(*) filter (where shadow)::text as shadow
      from eligibility_evaluations
    `;
    expect(Number(stored?.n)).toBe(2917);
    expect(Number(stored?.shadow)).toBe(2917);
    // One row per intake, and every intake has one.
    const [unevaluated] = await database.sql<{ n: string }[]>`
      select count(*)::text as n from intakes i
      where not exists (select 1 from eligibility_evaluations e where e.intake_id = i.id)
    `;
    expect(Number(unevaluated?.n)).toBe(0);

    // Nothing was applied: every legacy intake still carries the state its outcome gave it.
    const [applied] = await database.sql<{ n: string }[]>`
      select count(*)::text as n from intakes where state::text not like 'legacy_%'
    `;
    expect(Number(applied?.n)).toBe(0);
    const outcomes = Object.values(first.shadow.outcomes).reduce((a, b) => a + b, 0);
    expect(outcomes).toBe(2917);
    expect(first.shadow.outcomes.not_evaluable).toBeGreaterThan(0);
  });

  // The reproducibility item deferred from the `feature/legacy-importer` review: the importer,
  // not a one-off script, produces the identity counts ADR-0006 was accepted with.
  it('reproduces the duplicate-patient tiers of ADR-0006 and merges tier 1', async () => {
    expect(first.identity).toEqual({
      groups: 70,
      rows: 140,
      tier1: 28,
      tier2: 3,
      tier3: 39,
      merged: 28,
      alreadyMerged: 0,
      // ADR-0011 item 9: all 28 pairs are identical on every person field.
      gainedFields: 0,
    });

    const [merged] = await database.sql<{ n: string }[]>`
      select count(*)::text as n from patients where merged_into is not null
    `;
    expect(Number(merged?.n)).toBe(28);
    // Nothing is dropped: the losing rows stay, and every legacy id still resolves.
    const [aliases] = await database.sql<{ n: string }[]>`
      select count(*)::text as n from patient_legacy_ids
    `;
    expect(Number(aliases?.n)).toBe(2466);
    const [orphaned] = await database.sql<{ n: string }[]>`
      select count(*)::text as n from patient_legacy_ids a
      join patients p on p.id = a.patient_id where p.merged_into is not null
    `;
    expect(Number(orphaned?.n)).toBe(0);
  });

  // ADR-0005's consent states, over the 2466 legacy rows and over the surviving patients.
  it('derives a consent state for every surviving patient', async () => {
    expect(first.consentStatesWritten).toBe(2466 - 28);

    const rows = await database.sql<{ state: string; n: string }[]>`
      select state, count(*)::text as n from consent_states group by 1 order by 1
    `;
    const states = Object.fromEntries(rows.map((r) => [r.state, Number(r.n)]));
    // ADR-0005's counts are over the 2466 legacy rows; these are over the 2438 surviving
    // patients, and the difference is exactly the 28 merged rows: 23 of them held `no_record`
    // and 5 `unknown_pre_log` -- a duplicate row that never appeared in the consent log. No
    // survivor's state changes, because the union of a patient's events gains nothing.
    expect(states).toEqual({
      granted: 2091,
      revoked: 269,
      conflict: 7,
      no_record: 74 - 23,
      unknown_pre_log: 25 - 5,
    });
    expect(Object.values(states).reduce((a, b) => a + b, 0)).toBe(2466 - 28);
    // Every state belongs to a surviving patient, and every survivor has exactly one.
    const [merged] = await database.sql<{ n: string }[]>`
      select count(*)::text as n from consent_states s
      join patients p on p.id = s.patient_id where p.merged_into is not null
    `;
    expect(Number(merged?.n)).toBe(0);
  });

  it('changes nothing but import_runs on a second run (R-A15, R-A16)', async () => {
    const before = await counts();

    const second = await runImport(database.db, options);

    const after = await counts();
    expect(after.import_runs).toBe(before.import_runs + 1);
    expect({ ...after, import_runs: 0 }).toEqual({ ...before, import_runs: 0 });
    expect(second.rulesApplied).toEqual(first.rulesApplied);
    expect(second.reviewItems).toEqual(first.reviewItems);
    expect(second.recordsInserted).toBe(0);
    expect(second.reviewItemsInserted).toBe(0);
    expect(second.canonical.patients).toEqual({ inserted: 0, updated: 0 });
    expect(second.canonical.intakes).toEqual({
      inserted: 0,
      updated: 0,
      orphans: 21,
      auditEntriesInserted: 0,
    });
    expect(second.canonical.consentEvents).toEqual({ inserted: 0, skipped: 0 });
    // The merges are found, not repeated: the alias table already resolves both ids of a pair
    // to the survivor (ADR-0006).
    expect(second.identity).toEqual({ ...first.identity, merged: 0, alreadyMerged: 28 });
    expect(second.consentStatesWritten).toBe(first.consentStatesWritten);
    // A shadow row is derived, so the second run rewrites the same 2917 rows rather than adding
    // a second verdict per intake (ADR-0011 item 2).
    expect(second.shadow).toEqual(first.shadow);
  });

  it('writes only its import_runs row on a dry run (ADR-0009 item 6)', async () => {
    const before = await counts();

    const dry = await runImport(database.db, { ...options, dryRun: true });

    const after = await counts();
    expect(after.import_runs).toBe(before.import_runs + 1);
    expect({ ...after, import_runs: 0 }).toEqual({ ...before, import_runs: 0 });
    expect(dry.dryRun).toBe(true);
    expect(dry.rulesApplied).toEqual(first.rulesApplied);
    const [run] = await database.db.select().from(importRuns).where(eq(importRuns.id, dry.runId));
    expect(run).toMatchObject({ dryRun: true, asOf: '2026-09-08', reportPath: null });
    expect(run?.finishedAt).not.toBeNull();
  });

  it('raises one item for a source row that changed since an earlier run and keeps the stored row', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wellis-export-'));
    for (const name of ['intakes.csv', 'consents.jsonl']) {
      copyFileSync(join('legacy_export', name), join(dir, name));
    }
    const lines = readFileSync('legacy_export/patients.csv', 'utf8').split('\r\n');
    const original = lines[1] as string;
    // bsn changes too, so the item's payload can be checked for a readable identifier.
    lines[1] = original.replace(',Delft,', ',Elsewhere,').replace(',251508596,', ',251508597,');
    expect(lines[1]).not.toBe(original);
    writeFileSync(join(dir, 'patients.csv'), lines.join('\r\n'));
    const before = await counts();

    const changed = await runImport(database.db, { ...options, exportDir: dir });

    expect(changed.raw.legacy_patients_raw).toEqual({
      inserted: 0,
      unchanged: 2465,
      changed: 1,
      repeated: 0,
    });
    expect(changed.reviewItemsInserted).toBe(1);
    const after = await counts();
    expect(after.review_items).toBe(before.review_items + 1);
    expect(after.legacy_patients_raw).toBe(before.legacy_patients_raw);
    const [item] = await database.db
      .select()
      .from(reviewItems)
      .where(eq(reviewItems.title, `source row changed since import run ${first.runId}`));
    expect(item).toMatchObject({ type: 'data_quality', scope: 'row', status: 'open' });
    // Only the columns that differ, and bsn masked: review_items.payload is jsonb, which the
    // console's column-level bsn masking cannot reach into.
    expect(item?.payload).toMatchObject({
      table: 'legacy_patients_raw',
      differences: {
        city: { stored: 'Delft', incoming: 'Elsewhere' },
        bsn: { stored: '******596', incoming: '******597' },
      },
    });
    const differing = Object.keys(
      (item?.payload as { differences: Record<string, unknown> }).differences,
    ).sort();
    expect(differing).toEqual(['bsn', 'city']);
    // No unchanged identifier and no readable bsn anywhere in the payload.
    const serialised = JSON.stringify(item?.payload);
    for (const secret of ['zeynep.chen@live.nl', '06-53549409', '23-08-2000', '251508596']) {
      expect(serialised).not.toContain(secret);
    }
    const [raw] = await database.sql<{ city: string }[]>`
      select city from legacy_patients_raw where legacy_id = ${original.split(',')[0] ?? ''}
    `;
    expect(raw?.city).toBe('Delft');
    // The canonical row follows the stored raw row, not the incoming one.
    const [patient] = await database.sql<{ city: string }[]>`
      select p.city from patients p join patient_legacy_ids a on a.patient_id = p.id
      where a.legacy_id = ${original.split(',')[0] ?? ''}
    `;
    expect(patient?.city).toBe('Delft');

    // A second run of the changed export raises no second item.
    const again = await runImport(database.db, { ...options, exportDir: dir });
    expect(again.reviewItemsInserted).toBe(0);
  });

  it('keeps a human-owned field and raises one item referencing the audit entry (R-A17)', async () => {
    const [alias] = await database.sql<{ patientId: string }[]>`
      select patient_id as "patientId" from patient_legacy_ids order by legacy_id limit 1
    `;
    const patientId = alias?.patientId ?? '';
    const [entry] = await database.db
      .insert(auditEntries)
      .values({
        actor: 'dr. reviewer',
        entityType: 'patient',
        entityId: patientId,
        reason: 'status confirmed by phone',
        changes: [{ field: 'status', from: 'active', to: 'paused' }],
      })
      .returning({ id: auditEntries.id });
    await database.db.update(patients).set({ status: 'paused' }).where(eq(patients.id, patientId));
    const before = await counts();

    const third = await runImport(database.db, options);

    expect(third.humanOwnedConflicts).toBe(1);
    expect(third.reviewItemsInserted).toBe(1);
    const [after] = await database.db.select().from(patients).where(eq(patients.id, patientId));
    expect(after?.status).toBe('paused');
    const items = await database.db
      .select()
      .from(reviewItems)
      .where(eq(reviewItems.patientId, patientId));
    const conflict = items.find((i) => i.field === 'status');
    expect(conflict).toMatchObject({ type: 'data_quality', scope: 'row' });
    expect(conflict?.reason).toContain(entry?.id ?? 'missing');
    expect(conflict?.payload).toMatchObject({ stored: 'paused', audit_entry_id: entry?.id });

    const fourth = await runImport(database.db, options);
    expect(fourth.humanOwnedConflicts).toBe(1);
    expect(fourth.reviewItemsInserted).toBe(0);
    expect((await counts()).review_items).toBe(before.review_items + 1);
  });
});
