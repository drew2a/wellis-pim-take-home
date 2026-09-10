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
    database = await createTestDatabase('constraints');
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

    it('accepts a closed item with a resolution_note', async () => {
      await database.db.insert(schema.reviewItems).values({
        ...rows.reviewItemRow('closed-with-note'),
        status: 'dismissed',
        resolutionNote: 'placeholder row, nothing to fix',
      });
    });
  });

  describe('normalisation_records', () => {
    it('rejects a duplicate (entity_type, entity_id, field, rule_code, from_value)', async () => {
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

    it('intake_id is unique', async () => {
      await database.db.insert(schema.intakes).values(rows.intakeRow('once'));

      await expectDatabaseError(
        database.db.insert(schema.intakes).values(rows.intakeRow('once')),
        UNIQUE,
      );
    });
  });
});
