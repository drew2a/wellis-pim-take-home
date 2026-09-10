import { getTableName, type Table } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';
import { createTestDatabase, expectDatabaseError, type TestDatabase } from '@/test/database';
import * as rows from '@/test/rows';

// ADR-0007: what is evidence is immutable in the database; what is derived or decided is not.
// One row per evidence table, plus one column to attempt an UPDATE on.
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
    database = await createTestDatabase('append_only');
    await database.migrate();
    const [run] = await database.db
      .insert(schema.importRuns)
      .values(rows.importRunRow())
      .returning({ id: schema.importRuns.id });
    importRunId = (run as { id: number }).id;
  });

  afterAll(async () => {
    await database.drop();
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
