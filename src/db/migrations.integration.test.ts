import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '@/test/database';

// The "Tables" section of ADR-0004, in name order. A table that appears here and not in the
// database, or the reverse, fails the test.
const ADR_0004_TABLES = [
  'audit_entries',
  'consent_events',
  'consent_states',
  'eligibility_evaluations',
  'import_runs',
  'intakes',
  'legacy_consent_events_raw',
  'legacy_intakes_raw',
  'legacy_patients_raw',
  'normalisation_records',
  'patient_legacy_ids',
  'patients',
  'review_items',
];

interface AppliedMigration {
  id: number;
  hash: string;
}

describe('migrations under drizzle/ (ADR-0004)', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.drop();
  });

  async function appliedMigrations(): Promise<AppliedMigration[]> {
    return database.sql<AppliedMigration[]>`
      select id, hash from drizzle.__drizzle_migrations order by id
    `;
  }

  async function publicTables(): Promise<string[]> {
    const rows = await database.sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' order by table_name
    `;
    return rows.map((row) => row.table_name);
  }

  it('apply from zero on an empty database and create every table of ADR-0004', async () => {
    expect(await publicTables()).toEqual([]);

    await database.migrate();

    expect(await publicTables()).toEqual(ADR_0004_TABLES);
  });

  it('record one row per journal entry', async () => {
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
      entries: unknown[];
    };

    expect(await appliedMigrations()).toHaveLength(journal.entries.length);
    expect(journal.entries.length).toBeGreaterThan(0);
  });

  it('are idempotent: a second run applies nothing and changes nothing', async () => {
    const before = await appliedMigrations();

    await database.migrate();

    expect(await appliedMigrations()).toEqual(before);
    expect(await publicTables()).toEqual(ADR_0004_TABLES);
  });
});
