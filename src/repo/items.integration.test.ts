// The standing a review item's patient is in now (`patientStanding`): the three facts that decide
// whether a clinical_history item is urgent or archival. Against a real database, because every
// one of them is a join a mistake would silently answer for the wrong person.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { consentStates, importRuns, patients, reviewItems } from '@/db/schema';
import { createTestDatabase, type TestDatabase, type TestDb } from '@/test/database';
import { importRunRow, patientRow, reviewItemRow } from '@/test/rows';

import { patientStanding } from './items';

let database: TestDatabase;
let db: TestDb;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  await database.migrate();
}, 60_000);

afterAll(async () => {
  await database.drop();
});

beforeEach(async () => {
  await database.truncateAll();
});

const run = async (asOf: string, dryRun = false): Promise<void> => {
  await db.insert(importRuns).values({ ...importRunRow(), asOf, dryRun });
};

async function patient(overrides: Partial<typeof patients.$inferInsert> = {}): Promise<string> {
  const [row] = await db
    .insert(patients)
    .values({ ...patientRow(), ...overrides })
    .returning({ id: patients.id });
  return row?.id ?? '';
}

async function item(patientId: string | null): Promise<typeof reviewItems.$inferSelect> {
  const [row] = await db
    .insert(reviewItems)
    .values({
      ...reviewItemRow(`clinical_history|row|legacy_intake:INT-8156|${Math.random()}`),
      type: 'clinical_history',
      patientId,
    })
    .returning();
  if (row === undefined) throw new Error('no review item');
  return row;
}

describe('the standing of the patient an item is about', () => {
  it('gives the status, the age on the import’s as-of date and the consent state', async () => {
    await run('2026-09-08');
    // The patient of INT-8156: 17 at submission in 2024, and an adult by the as-of date.
    const patientId = await patient({ status: 'active', dob: '2006-08-11' });
    await db.insert(consentStates).values({
      patientId,
      type: 'data_processing',
      state: 'granted',
      derivationVersion: '1',
    });

    expect(await patientStanding(db, await item(patientId))).toEqual({
      status: 'active',
      ageYears: 20,
      asOf: '2026-09-08',
      consent: { data_processing: 'granted' },
    });
  });

  // The age is measured from the run's `--as-of`, never the wall clock, so the console and the
  // import report answer "how old are they now" with the same date (ADR-0009 item 5).
  it('measures the age from the latest real run, ignoring a dry run after it', async () => {
    await run('2026-09-08');
    await run('2030-01-01', true);
    const patientId = await patient({ dob: '2006-08-11' });

    expect((await patientStanding(db, await item(patientId)))?.ageYears).toBe(20);
  });

  it('reads the survivor of a merge, not the record the item names (ADR-0008)', async () => {
    await run('2026-09-08');
    const survivorId = await patient({ status: 'paused', dob: '2000-01-01' });
    const loserId = await patient({ status: 'churned', dob: '1990-01-01', mergedInto: survivorId });
    await db.insert(consentStates).values({
      patientId: survivorId,
      type: 'data_processing',
      state: 'revoked',
      derivationVersion: '1',
    });

    expect(await patientStanding(db, await item(loserId))).toMatchObject({
      status: 'paused',
      ageYears: 26,
      consent: { data_processing: 'revoked' },
    });
  });

  it('says the age is unknown rather than guessing when the export gave no date of birth', async () => {
    await run('2026-09-08');
    const patientId = await patient({ dob: null });

    expect((await patientStanding(db, await item(patientId)))?.ageYears).toBeNull();
  });

  it('has no consent to report for a patient with no state at all', async () => {
    await run('2026-09-08');

    expect((await patientStanding(db, await item(await patient())))?.consent).toEqual({});
  });

  it('is null for an item that names no patient', async () => {
    await run('2026-09-08');

    expect(await patientStanding(db, await item(null))).toBeNull();
  });

  // Every item of this kind was raised by an import, so a database without one is this code
  // reading a state that cannot exist — loudly, rather than measuring an age against today
  // (`CLAUDE.md` §2).
  it('refuses to measure an age when no import run says as of when', async () => {
    const patientId = await patient({ dob: '2006-08-11' });
    const raised = await item(patientId);

    await expect(patientStanding(db, raised)).rejects.toThrow(/as-of/u);
  });
});
