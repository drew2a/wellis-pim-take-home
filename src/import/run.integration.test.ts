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
      legacy_patients_raw: { inserted: 2466, unchanged: 0, changed: 0 },
      legacy_intakes_raw: { inserted: 2917, unchanged: 0, changed: 0 },
      legacy_consent_events_raw: { inserted: 2643, unchanged: 0, changed: 0 },
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
      'data_quality/row': 11 + 10 + 5 + 17 + 6 + 3,
      'orphan_intake/row': 21,
      'vocabulary/vocabulary': 5,
    });
    expect(first.reviewItemsInserted).toBe(52 + 21 + 5);
    expect(await itemCounts()).toEqual(first.reviewItems);
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
    lines[1] = original.replace(',Delft,', ',Elsewhere,');
    expect(lines[1]).not.toBe(original);
    writeFileSync(join(dir, 'patients.csv'), lines.join('\r\n'));
    const before = await counts();

    const changed = await runImport(database.db, { ...options, exportDir: dir });

    expect(changed.raw.legacy_patients_raw).toEqual({ inserted: 0, unchanged: 2465, changed: 1 });
    expect(changed.reviewItemsInserted).toBe(1);
    const after = await counts();
    expect(after.review_items).toBe(before.review_items + 1);
    expect(after.legacy_patients_raw).toBe(before.legacy_patients_raw);
    const [item] = await database.db
      .select()
      .from(reviewItems)
      .where(eq(reviewItems.title, `source row changed since import run ${first.runId}`));
    expect(item).toMatchObject({ type: 'data_quality', scope: 'row', status: 'open' });
    expect(item?.payload).toMatchObject({
      table: 'legacy_patients_raw',
      stored: { city: 'Delft' },
      incoming: { city: 'Elsewhere' },
    });
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
