import { isPgEnum, type PgEnum } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';
import { createTestDatabase, expectDatabaseError, type TestDatabase } from '@/test/database';
import * as rows from '@/test/rows';

const UNIQUE = /duplicate key value violates unique constraint/;
const CHECK = /violates check constraint/;
const FOREIGN_KEY = /violates foreign key constraint/;
const UNKNOWN_ENUM_VALUE = /invalid input value for enum/;

// A well-formed id that no row has.
const NOWHERE = '00000000-0000-4000-8000-000000000000';

describe('database constraints (ADR-0004)', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
    await database.migrate();
  });

  afterAll(async () => {
    await database.drop();
  });

  async function insertPatient(
    overrides: Partial<typeof schema.patients.$inferInsert> = {},
  ): Promise<string> {
    const [row] = await database.db
      .insert(schema.patients)
      .values({ ...rows.patientRow(), ...overrides })
      .returning({ id: schema.patients.id });
    return (row as { id: string }).id;
  }

  describe('patient_legacy_ids', () => {
    it('is unique on legacy_id: one legacy id resolves to exactly one patient', async () => {
      const first = await insertPatient();
      const second = await insertPatient();
      await database.db
        .insert(schema.patientLegacyIds)
        .values({ legacyId: 'recA', patientId: first });

      await expectDatabaseError(
        database.db.insert(schema.patientLegacyIds).values({ legacyId: 'recA', patientId: second }),
        UNIQUE,
      );
    });
  });

  describe('review_items', () => {
    it('rejects a second row with the same dedupe_key (R-A15, R-A17)', async () => {
      await database.db.insert(schema.reviewItems).values(rows.reviewItemRow('dup'));

      await expectDatabaseError(
        database.db.insert(schema.reviewItems).values(rows.reviewItemRow('dup')),
        UNIQUE,
      );
    });

    it('rejects a closed item without a resolution_note', async () => {
      await expectDatabaseError(
        database.db
          .insert(schema.reviewItems)
          .values({ ...rows.reviewItemRow('closed-without-note'), status: 'resolved' }),
        CHECK,
      );
    });

    it('accepts a closed item with a resolution_note, resolved_by and resolved_at', async () => {
      await database.db.insert(schema.reviewItems).values({
        ...rows.reviewItemRow('closed-with-note'),
        status: 'dismissed',
        resolutionNote: 'placeholder row, nothing to fix',
        resolvedBy: 'reviewer@example.com',
        resolvedAt: new Date('2026-09-11T10:00:00Z'),
      });
    });

    // ADR-0008 item 6: a closed decision without actor and time is an audit gap (R-B20).
    it.each(['resolvedBy', 'resolvedAt'] as const)(
      'rejects a closed item without %s',
      async (missing) => {
        const closed = {
          ...rows.reviewItemRow(`closed-without-${missing}`),
          status: 'resolved' as const,
          resolutionNote: 'note present',
          resolvedBy: 'reviewer@example.com',
          resolvedAt: new Date('2026-09-11T10:00:00Z'),
          [missing]: null,
        };

        await expectDatabaseError(database.db.insert(schema.reviewItems).values(closed), CHECK);
      },
    );

    it('accepts an open item without resolver, time or note', async () => {
      await database.db.insert(schema.reviewItems).values(rows.reviewItemRow('still-open'));
    });
  });

  describe('normalisation_records', () => {
    it('rejects a duplicate (entity_type, entity_id, field, rule_code, from_value, to_value)', async () => {
      await database.db.insert(schema.normalisationRecords).values(rows.normalisationRecordRow());

      await expectDatabaseError(
        database.db.insert(schema.normalisationRecords).values(rows.normalisationRecordRow()),
        UNIQUE,
      );
    });

    it('accepts the same rule on the same field when the raw value differs', async () => {
      await database.db
        .insert(schema.normalisationRecords)
        .values({ ...rows.normalisationRecordRow(), fromValue: 'active  ' });
    });

    // ADR-0008 item 3: a later importer version mapping the same raw value elsewhere is a new
    // fact about a new run; both rows stand.
    it('accepts the same rule on the same raw value when to_value differs', async () => {
      await database.db
        .insert(schema.normalisationRecords)
        .values({ ...rows.normalisationRecordRow(), toValue: 'paused', importerVersion: 'v2' });
    });

    it('treats two null to_values as equal (NULLS NOT DISTINCT), so a blanking rule dedupes too', async () => {
      const blanked = { ...rows.normalisationRecordRow(), field: 'weight_kg', toValue: null };
      await database.db.insert(schema.normalisationRecords).values(blanked);

      await expectDatabaseError(
        database.db.insert(schema.normalisationRecords).values(blanked),
        UNIQUE,
      );
    });
  });

  // ADR-0008 item 1: the trigger forbids delete-and-rewrite, so a re-run needs a conflict target.
  describe('consent_events', () => {
    it('rejects a second legacy event with the same source_line', async () => {
      await database.db
        .insert(schema.consentEvents)
        .values({ ...rows.consentEventRow(), sourceLine: 7 });

      await expectDatabaseError(
        database.db
          .insert(schema.consentEvents)
          .values({ ...rows.consentEventRow(), sourceLine: 7 }),
        UNIQUE,
      );
    });

    it('accepts any number of new-flow events, which have no source_line', async () => {
      await database.db
        .insert(schema.consentEvents)
        .values([rows.consentEventRow(), rows.consentEventRow()]);
    });
  });

  describe('audit_entries', () => {
    it('rejects a second importer entry with the same dedupe_key', async () => {
      const key = 'intake:INT-000001:null:legacy_approved:legacy outcome';
      await database.db
        .insert(schema.auditEntries)
        .values({ ...rows.auditEntryRow(), dedupeKey: key });

      await expectDatabaseError(
        database.db.insert(schema.auditEntries).values({ ...rows.auditEntryRow(), dedupeKey: key }),
        UNIQUE,
      );
    });

    it('accepts any number of human entries, which have no dedupe_key', async () => {
      await database.db
        .insert(schema.auditEntries)
        .values([rows.auditEntryRow(), rows.auditEntryRow()]);
    });
  });

  describe('enums', () => {
    // Widened so one loop can cover every enum; `isPgEnum` narrows only to the exact literal types.
    const enums = Object.values(schema).filter((value) => isPgEnum(value)) as PgEnum<
      [string, ...string[]]
    >[];

    it('are all present in the database', async () => {
      const inDatabase = await database.sql<{ typname: string }[]>`
        select typname from pg_type where typtype = 'e' order by typname
      `;

      expect(inDatabase.map((row) => row.typname)).toEqual(
        enums.map((e) => e.enumName).sort((a, b) => a.localeCompare(b)),
      );
    });

    it.each(enums.map((e) => [e.enumName, e] as const))(
      '%s rejects an unknown value and accepts every declared one',
      async (name, pgEnum) => {
        await expectDatabaseError(
          database.sql`select ${'not-a-member'}::${database.sql(name)}`,
          UNKNOWN_ENUM_VALUE,
        );

        for (const value of pgEnum.enumValues) {
          await database.sql`select ${value}::${database.sql(name)}`;
        }
      },
    );
  });

  describe('patients', () => {
    it.each(['12345678', '1234567890', '12345678a', ' 123456789'])(
      'bsn CHECK rejects %j',
      async (bsn) => {
        await expectDatabaseError(insertPatient({ bsn, bsnCheck: 'invalid' }), CHECK);
      },
    );

    it('bsn CHECK accepts nine digits and null', async () => {
      await insertPatient({ bsn: '123456789', bsnCheck: 'valid' });
      await insertPatient({ bsn: null, bsnCheck: 'absent' });
    });

    // ADR-0008 item 6: an absent number cannot have been checked valid or invalid.
    it.each(['valid', 'invalid'] as const)(
      'rejects a null bsn with bsn_check %s',
      async (bsnCheck) => {
        await expectDatabaseError(insertPatient({ bsn: null, bsnCheck }), CHECK);
      },
    );

    it('phone CHECK accepts +316 followed by eight digits and rejects the national form', async () => {
      await insertPatient({ phone: '+31612345678' });

      await expectDatabaseError(insertPatient({ phone: '0612345678' }), CHECK);
    });

    it.each([
      ['weightKg', '0'],
      ['weightKg', '-1.0'],
      ['heightCm', 0],
      ['heightCm', -170],
    ] as const)('%s CHECK rejects %s: the database only checks > 0', async (column, value) => {
      await expectDatabaseError(insertPatient({ [column]: value }), CHECK);
    });

    it('weight and height accept any positive value; bounds live in the rules file', async () => {
      await insertPatient({ weightKg: '0.1', heightCm: 1 });
      await insertPatient({ weightKg: '9999.9', heightCm: 9999 });
    });

    it('merged_into references patients', async () => {
      const survivor = await insertPatient();

      await insertPatient({ mergedInto: survivor });
      await expectDatabaseError(insertPatient({ mergedInto: NOWHERE }), FOREIGN_KEY);
    });

    // ADR-0008 item 6: a self-merge would loop survivor resolution forever.
    it('rejects merged_into pointing at the row itself', async () => {
      const id = '11111111-1111-4111-8111-111111111111';

      await expectDatabaseError(insertPatient({ id, mergedInto: id }), CHECK);
    });
  });

  describe('intakes', () => {
    it('patient_id accepts null for orphans and rejects an unknown patient', async () => {
      await database.db
        .insert(schema.intakes)
        .values({ ...rows.intakeRow('orphan'), patientId: null });

      await expectDatabaseError(
        database.db
          .insert(schema.intakes)
          .values({ ...rows.intakeRow('dangling'), patientId: NOWHERE }),
        FOREIGN_KEY,
      );
    });

    // ADR-0008 item 4: canonical rows carry the run that created them.
    it('created_by_run references import_runs and accepts null for the new flow', async () => {
      const [run] = await database.db
        .insert(schema.importRuns)
        .values(rows.importRunRow())
        .returning({ id: schema.importRuns.id });

      await database.db
        .insert(schema.intakes)
        .values({ ...rows.intakeRow('imported'), createdByRun: (run as { id: number }).id });
      await database.db
        .insert(schema.intakes)
        .values({ ...rows.intakeRow('new-flow'), createdByRun: null });
      await expectDatabaseError(
        database.db
          .insert(schema.intakes)
          .values({ ...rows.intakeRow('bad-run'), createdByRun: 999999 }),
        FOREIGN_KEY,
      );
    });

    it('intake_id is unique', async () => {
      await database.db.insert(schema.intakes).values(rows.intakeRow('once'));

      await expectDatabaseError(
        database.db.insert(schema.intakes).values(rows.intakeRow('once')),
        UNIQUE,
      );
    });
  });
});
