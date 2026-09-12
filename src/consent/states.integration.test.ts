// `consent_states` is derived, so it is recomputed rather than patched (ADR-0004, ADR-0007): the
// derivation runs over the union of events the membership returns, and a merged-away patient has
// no state of its own (ADR-0011 items 13 and 17).
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { consentEvents, consentStates, patients } from '@/db/schema';
import { createTestDatabase, type TestDatabase } from '@/test/database';
import * as rows from '@/test/rows';

import { CONSENT_DERIVATION_VERSION } from './derive';
import { recomputeConsentStates } from './states';

const TYPES = ['data_processing'];

describe('recomputeConsentStates', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
    await database.migrate();
  });

  afterAll(async () => {
    await (database as TestDatabase | undefined)?.drop();
  });

  beforeEach(async () => {
    await database.truncateAll();
  });

  async function insertPatient(fullName: string, signupDate: string | null): Promise<string> {
    const [row] = await database.db
      .insert(patients)
      .values({ ...rows.patientRow(), fullName, signupDate })
      .returning({ id: patients.id });
    return (row as { id: string }).id;
  }

  const grant = (patientId: string, at: string, line: number) => ({
    ...rows.consentEventRow(),
    patientId,
    at: new Date(at),
    sourceLine: line,
  });

  async function statesOf(patientId: string) {
    return database.db.select().from(consentStates).where(eq(consentStates.patientId, patientId));
  }

  it('writes one row per declared type, with the derivation version', async () => {
    const patient = await insertPatient('Granted', '2024-01-01');
    await database.db.insert(consentEvents).values(grant(patient, '2024-02-01T10:00:00Z', 1));

    await recomputeConsentStates(database.db, { declaredTypes: TYPES });

    expect(await statesOf(patient)).toMatchObject([
      {
        type: 'data_processing',
        state: 'granted',
        derivationVersion: CONSENT_DERIVATION_VERSION,
      },
    ]);
  });

  it('derives over the union of a membership and leaves a merged patient no state', async () => {
    const survivor = await insertPatient('Survivor', '2024-01-01');
    const loser = await insertPatient('Loser', '2024-01-01');
    await database.db.insert(consentEvents).values([
      grant(survivor, '2024-02-01T10:00:00Z', 1),
      // The loser's revocation is later, so the union revokes; a derivation over the survivor's
      // own events alone would answer `granted` and act on a consent that was withdrawn.
      { ...grant(loser, '2024-03-01T10:00:00Z', 2), action: 'revoked' as const },
    ]);
    await recomputeConsentStates(database.db, { declaredTypes: TYPES });
    expect((await statesOf(survivor))[0]?.state).toBe('granted');

    await database.db.update(patients).set({ mergedInto: survivor }).where(eq(patients.id, loser));
    await recomputeConsentStates(database.db, { declaredTypes: TYPES });

    expect((await statesOf(survivor))[0]?.state).toBe('revoked');
    expect(await statesOf(loser)).toEqual([]);
  });

  // ADR-0011 item 17: the cut-over asks when this person could first have been in the log, so a
  // membership is placed by its earliest signup date, and an unusable one leaves it unknowable.
  it('places a membership by its earliest signup date', async () => {
    const survivor = await insertPatient('Survivor', '2024-01-01');
    const loser = await insertPatient('Loser', '2022-05-01');

    await recomputeConsentStates(database.db, { declaredTypes: TYPES });
    expect((await statesOf(survivor))[0]?.state).toBe('no_record');

    await database.db.update(patients).set({ mergedInto: survivor }).where(eq(patients.id, loser));
    await recomputeConsentStates(database.db, { declaredTypes: TYPES });

    expect((await statesOf(survivor))[0]?.state).toBe('unknown_pre_log');
  });

  it('recomputes only the patients it is given, membership included', async () => {
    const survivor = await insertPatient('Survivor', '2024-01-01');
    const loser = await insertPatient('Loser', '2024-01-01');
    const untouched = await insertPatient('Untouched', '2024-01-01');
    await database.db.update(patients).set({ mergedInto: survivor }).where(eq(patients.id, loser));

    const written = await recomputeConsentStates(database.db, {
      declaredTypes: TYPES,
      survivorIds: [survivor],
    });

    expect(written).toBe(1);
    expect((await statesOf(survivor))[0]?.state).toBe('no_record');
    expect(await statesOf(untouched)).toEqual([]);
  });

  it('is idempotent: a second pass writes the same rows', async () => {
    const patient = await insertPatient('Granted', '2024-01-01');
    await database.db.insert(consentEvents).values(grant(patient, '2024-02-01T10:00:00Z', 1));

    await recomputeConsentStates(database.db, { declaredTypes: TYPES });
    const first = await statesOf(patient);
    await recomputeConsentStates(database.db, { declaredTypes: TYPES });
    const second = await statesOf(patient);

    expect(second.map((row) => ({ ...row, computedAt: null }))).toEqual(
      first.map((row) => ({ ...row, computedAt: null })),
    );
  });
});
