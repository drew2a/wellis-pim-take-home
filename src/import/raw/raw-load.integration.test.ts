// Raw layer (ADR-0004, R-A8, R-A15): every row lands as exported, a second load inserts nothing,
// and a changed source row is reported with both versions while the stored row stays.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { legacyIntakesRaw, legacyPatientsRaw } from '@/db/schema';
import { createTestDatabase, type TestDatabase } from '@/test/database';

import { startRun } from '../runs';
import { parseCsv, serialiseCsvRecord, type CsvRecord } from '../source/csv';
import { readExportFiles } from '../source/files';
import { parseConsentsJsonl } from '../source/jsonl';
import { INTAKES_HEADER, PATIENTS_HEADER } from '../source/layout';
import { loadRawConsentEvents, loadRawIntakes, loadRawPatients } from './load';

const files = readExportFiles('legacy_export');
const patients = parseCsv(files['patients.csv'].bytes, PATIENTS_HEADER);
const intakes = parseCsv(files['intakes.csv'].bytes, INTAKES_HEADER);
const consents = parseConsentsJsonl(files['consents.jsonl'].bytes);

describe('raw load', () => {
  let database: TestDatabase;
  let firstRun: number;

  beforeAll(async () => {
    database = await createTestDatabase();
    await database.migrate();
    firstRun = await startRun(database.db, { files, asOf: '2026-09-08', dryRun: false });
  });

  afterAll(async () => {
    await (database as TestDatabase | undefined)?.drop();
  });

  async function count(table: string): Promise<number> {
    const [row] = await database.sql<
      { n: string }[]
    >`select count(*)::text as n from ${database.sql(table)}`;
    return Number(row?.n);
  }

  it('inserts every row of the three files once', async () => {
    const p = await loadRawPatients(database.db, firstRun, patients);
    const i = await loadRawIntakes(database.db, firstRun, intakes);
    const c = await loadRawConsentEvents(database.db, firstRun, consents);
    expect([p.inserted, i.inserted, c.inserted]).toEqual([2466, 2917, 2643]);
    expect([p.changed, i.changed, c.changed]).toEqual([[], [], []]);
    expect(await count('legacy_patients_raw')).toBe(2466);
    expect(await count('legacy_intakes_raw')).toBe(2917);
    expect(await count('legacy_consent_events_raw')).toBe(2643);
  });

  it('stores every CSV row so that its columns re-serialise to the source line', async () => {
    const source = Buffer.from(files['intakes.csv'].bytes).toString('utf8').split('\r\n');
    const stored = await database.db
      .select()
      .from(legacyIntakesRaw)
      .orderBy(legacyIntakesRaw.lineNo);
    expect(stored).toHaveLength(2917);
    for (const row of stored) {
      const fields = [
        row.intakeId,
        row.legacyPatientId,
        row.submittedAt,
        row.questionnaireVersion,
        row.weight,
        row.height,
        row.medsCurrent,
        row.conditions,
        row.alcoholUnitsWeek,
        row.outcome,
        row.reviewerNote,
      ];
      expect(serialiseCsvRecord(fields)).toBe(source[row.lineNo - 1]);
    }
    // Untrimmed: the 385 `approved ` rows keep their trailing space (data-profile P-25).
    const trailing = await database.db.$count(
      legacyIntakesRaw,
      sql`${legacyIntakesRaw.outcome} = 'approved '`,
    );
    expect(trailing).toBe(385);
  });

  it('is a no-op on a second load with the same export (R-A15)', async () => {
    const secondRun = await startRun(database.db, { files, asOf: '2026-09-08', dryRun: false });
    const p = await loadRawPatients(database.db, secondRun, patients);
    const i = await loadRawIntakes(database.db, secondRun, intakes);
    const c = await loadRawConsentEvents(database.db, secondRun, consents);
    expect([p.inserted, i.inserted, c.inserted]).toEqual([0, 0, 0]);
    expect([p.unchanged, i.unchanged, c.unchanged]).toEqual([2466, 2917, 2643]);
    expect([p.changed, i.changed, c.changed]).toEqual([[], [], []]);
    expect(await count('legacy_patients_raw')).toBe(2466);
    // Rows still name the run that first stored them.
    const [row] = await database.sql<{ runs: string }[]>`
      select string_agg(distinct import_run_id::text, ',') as runs from legacy_patients_raw
    `;
    expect(row?.runs).toBe(String(firstRun));
  });

  it('reports a changed source row with both versions and leaves the stored row alone', async () => {
    const original = patients[0] as CsvRecord;
    const modifiedFields = original.fields.map((f, i) => (i === 7 ? 'Elsewhere' : f));
    const modified: CsvRecord = {
      lineNo: original.lineNo,
      raw: Buffer.from(serialiseCsvRecord(modifiedFields), 'utf8'),
      fields: modifiedFields,
    };
    const thirdRun = await startRun(database.db, { files, asOf: '2026-09-08', dryRun: false });

    const result = await loadRawPatients(database.db, thirdRun, [modified]);

    expect(result.inserted).toBe(0);
    expect(result.changed).toHaveLength(1);
    const change = result.changed[0];
    expect(change?.table).toBe('legacy_patients_raw');
    expect(change?.key).toBe(original.fields[0]);
    expect(change?.stored.city).toBe(original.fields[7]);
    expect(change?.stored.importRunId).toBe(firstRun);
    expect(change?.incoming.city).toBe('Elsewhere');
    expect(change?.stored.rowHash).not.toBe(change?.incoming.rowHash);

    const [stored] = await database.db
      .select()
      .from(legacyPatientsRaw)
      .where(sql`${legacyPatientsRaw.legacyId} = ${original.fields[0]}`);
    expect(stored?.city).toBe(original.fields[7]);
  });
});
