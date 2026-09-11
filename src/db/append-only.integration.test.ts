import { getTableName, type Table } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { APPEND_ONLY_TABLE_NAMES } from '@/db/append-only';
import * as schema from '@/db/schema';
import { createTestDatabase, expectDatabaseError, type TestDatabase } from '@/test/database';
import * as rows from '@/test/rows';

// One row per table in APPEND_ONLY_TABLES (src/db/append-only.ts), plus one column to attempt
// an UPDATE on; a test below fails if this list and that one drift apart.
interface EvidenceTable {
  table: Table;
  column: string;
  insert: (database: TestDatabase, importRunId: number) => Promise<unknown>;
}

const EVIDENCE_TABLES: EvidenceTable[] = [
  {
    table: schema.auditEntries,
    column: 'reason',
    insert: ({ db }) => db.insert(schema.auditEntries).values(rows.auditEntryRow()),
  },
  {
    table: schema.consentEvents,
    column: 'action',
    insert: ({ db }) => db.insert(schema.consentEvents).values(rows.consentEventRow()),
  },
  {
    table: schema.normalisationRecords,
    column: 'to_value',
    insert: ({ db }) =>
      db.insert(schema.normalisationRecords).values(rows.normalisationRecordRow()),
  },
  {
    table: schema.legacyPatientsRaw,
    column: 'status',
    insert: ({ db }, runId) =>
      db.insert(schema.legacyPatientsRaw).values(rows.legacyPatientRawRow(runId)),
  },
  {
    table: schema.legacyIntakesRaw,
    column: 'outcome',
    insert: ({ db }, runId) =>
      db.insert(schema.legacyIntakesRaw).values(rows.legacyIntakeRawRow(runId)),
  },
  {
    table: schema.legacyConsentEventsRaw,
    column: 'action',
    insert: ({ db }, runId) =>
      db.insert(schema.legacyConsentEventsRaw).values(rows.legacyConsentEventRawRow(runId)),
  },
];

const APPEND_ONLY = /is evidence and append-only/;

describe('evidence tables are append-only (R-B21, ADR-0007)', () => {
  let database: TestDatabase;
  let importRunId: number;

  beforeAll(async () => {
    database = await createTestDatabase();
    await database.migrate();
    const [run] = await database.db
      .insert(schema.importRuns)
      .values(rows.importRunRow())
      .returning({ id: schema.importRuns.id });
    importRunId = (run as { id: number }).id;
  });

  afterAll(async () => {
    // Still runs when beforeAll failed before assigning `database`; a TypeError here would bury
    // the real failure under a second one.
    await (database as TestDatabase | undefined)?.drop();
  });

  const declared = [...APPEND_ONLY_TABLE_NAMES].sort((a, b) => a.localeCompare(b));

  it('covers exactly the tables declared in src/db/append-only.ts', () => {
    const tested = EVIDENCE_TABLES.map((t) => getTableName(t.table)).sort((a, b) =>
      a.localeCompare(b),
    );

    expect(tested).toEqual(declared);
  });

  it('matches the tables that carry the trigger in the migrated database', async () => {
    // The migration is hand-written SQL, so this is the only check that the declared list and
    // drizzle/0001_append_only_evidence.sql name the same tables.
    const rows = await database.sql<{ relname: string }[]>`
      select c.relname
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where t.tgfoid = 'reject_evidence_mutation'::regproc and not t.tgisinternal
      order by c.relname
    `;

    expect(rows.map((row) => row.relname)).toEqual(declared);
  });

  describe.each(EVIDENCE_TABLES.map((t) => [getTableName(t.table), t] as const))(
    '%s',
    (name, { column, insert }) => {
      async function count(): Promise<number> {
        const [row] = await database.sql<{ n: string }[]>`
          select count(*)::text as n from ${database.sql(name)}
        `;
        return Number(row?.n);
      }

      it('accepts INSERT', async () => {
        await insert(database, importRunId);

        expect(await count()).toBe(1);
      });

      it('rejects UPDATE, even one that changes nothing', async () => {
        const statement = `update "${name}" set "${column}" = "${column}"`;

        await expectDatabaseError(database.sql.unsafe(statement), APPEND_ONLY);
      });

      it('rejects DELETE', async () => {
        await expectDatabaseError(database.sql.unsafe(`delete from "${name}"`), APPEND_ONLY);

        expect(await count()).toBe(1);
      });

      it('rejects TRUNCATE', async () => {
        // CASCADE so that a referencing table (consent_states on consent_events) is not what
        // stops the statement: the trigger must be the reason.
        await expectDatabaseError(database.sql.unsafe(`truncate "${name}" cascade`), APPEND_ONLY);

        expect(await count()).toBe(1);
      });
    },
  );
});
