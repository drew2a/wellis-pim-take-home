// A consent state a human established over a log that contradicts itself (ADR-0025).
//
// The decision is the audit entry; this row is its cache. It is kept while the evidence it was
// taken over is still the latest, and superseded by an event that orders after it — so a patient
// who later consents properly needs nobody to remember them.
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { consentEvents, consentStates, patients } from '@/db/schema';
import { createTestDatabase, type TestDatabase, type TestDb } from '@/test/database';
import { patientRow } from '@/test/rows';

import { HUMAN_DERIVATION } from './derive';
import { establishConsentState, recomputeConsentStates } from './states';

const TYPE = 'data_processing';
const TYPES = [TYPE];

let database: TestDatabase;
let db: TestDb;
let patientId: string;

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
  const [row] = await db
    .insert(patients)
    .values({ ...patientRow(), signupDate: '2025-01-01' })
    .returning({ id: patients.id });
  patientId = row?.id ?? '';
});

/** A log that contradicts itself: the first event is a revocation (ADR-0011 item 15). */
async function contradictoryLog(): Promise<void> {
  await db.insert(consentEvents).values([
    { patientId, type: TYPE, action: 'revoked', at: new Date('2025-02-01T10:00:00Z') },
    { patientId, type: TYPE, action: 'granted', at: new Date('2025-02-09T10:00:00Z') },
  ]);
  await recomputeConsentStates(db, { declaredTypes: TYPES });
}

const stateRow = async () => {
  const [row] = await db
    .select()
    .from(consentStates)
    .where(and(eq(consentStates.patientId, patientId), eq(consentStates.type, TYPE)));
  return row;
};

const addEvent = async (at: string, action: 'granted' | 'revoked' = 'granted') => {
  await db.insert(consentEvents).values({ patientId, type: TYPE, action, at: new Date(at) });
};

describe('establishing a state', () => {
  it('writes it over the derived conflict, marked as a person’s', async () => {
    await contradictoryLog();
    expect((await stateRow())?.state).toBe('conflict');

    await establishConsentState(db, { patientId, type: TYPE, state: 'granted' });
    const row = await stateRow();
    expect(row).toMatchObject({ state: 'granted', derivationVersion: HUMAN_DERIVATION });
  });

  // On a human row this names the last event the decision was taken over, which is what makes
  // supersession checkable (ADR-0025 item 2).
  it('records the last event that existed when the decision was taken', async () => {
    await contradictoryLog();
    await establishConsentState(db, { patientId, type: TYPE, state: 'granted' });

    const events = await db.select().from(consentEvents);
    const last = [...events].sort((a, b) => a.at.getTime() - b.at.getTime()).at(-1);
    expect((await stateRow())?.derivedFromEventId).toBe(last?.id);
  });

  it('replaces an earlier decision rather than adding a second row', async () => {
    await contradictoryLog();
    await establishConsentState(db, { patientId, type: TYPE, state: 'granted' });
    await establishConsentState(db, { patientId, type: TYPE, state: 'revoked' });
    expect(await db.select().from(consentStates)).toHaveLength(1);
    expect((await stateRow())?.state).toBe('revoked');
  });
});

describe('what the recomputation does with it', () => {
  it('keeps it while the evidence it was taken over is still the latest', async () => {
    await contradictoryLog();
    await establishConsentState(db, { patientId, type: TYPE, state: 'granted' });
    const before = await stateRow();

    await recomputeConsentStates(db, { declaredTypes: TYPES });

    const after = await stateRow();
    expect(after).toMatchObject({ state: 'granted', derivationVersion: HUMAN_DERIVATION });
    expect(after?.computedAt).toEqual(before?.computedAt);
  });

  // A patient who later consents properly needs nobody to remember them.
  it('is superseded by an event that orders after it', async () => {
    await contradictoryLog();
    await establishConsentState(db, { patientId, type: TYPE, state: 'revoked' });
    await addEvent('2025-06-01T10:00:00Z', 'granted');

    await recomputeConsentStates(db, { declaredTypes: TYPES });

    const row = await stateRow();
    // The log still opens with a revocation, so the derivation's answer is still `conflict` —
    // what matters is that the human answer no longer stands in for it.
    expect(row?.derivationVersion).not.toBe(HUMAN_DERIVATION);
    expect(row?.state).toBe('conflict');
  });

  // The log is append-only and this export backfills nothing; a decision is superseded by evidence
  // that postdates what it was taken over, not by evidence that predates it.
  it('is not superseded by an event that orders before it', async () => {
    await contradictoryLog();
    await establishConsentState(db, { patientId, type: TYPE, state: 'granted' });
    await addEvent('2025-01-15T10:00:00Z', 'revoked');

    await recomputeConsentStates(db, { declaredTypes: TYPES });
    expect((await stateRow())?.derivationVersion).toBe(HUMAN_DERIVATION);
  });

  // A future-dated revocation that was already in the log was in front of the reviewer.
  it('is not superseded by an event that was already there', async () => {
    await db.insert(consentEvents).values([
      { patientId, type: TYPE, action: 'revoked', at: new Date('2025-02-01T10:00:00Z') },
      { patientId, type: TYPE, action: 'revoked', at: new Date('2027-06-14T19:21:00Z') },
    ]);
    await recomputeConsentStates(db, { declaredTypes: TYPES });
    await establishConsentState(db, { patientId, type: TYPE, state: 'granted' });

    await recomputeConsentStates(db, { declaredTypes: TYPES });
    expect((await stateRow())?.state).toBe('granted');
  });

  it('leaves every other patient’s row derived as before', async () => {
    await contradictoryLog();
    await establishConsentState(db, { patientId, type: TYPE, state: 'granted' });

    const [other] = await db
      .insert(patients)
      .values({ ...patientRow(), fullName: 'Someone Else', signupDate: '2025-01-01' })
      .returning({ id: patients.id });
    await db.insert(consentEvents).values({
      patientId: other?.id ?? '',
      type: TYPE,
      action: 'granted',
      at: new Date('2025-03-01T10:00:00Z'),
    });

    await recomputeConsentStates(db, { declaredTypes: TYPES });

    const [row] = await db
      .select()
      .from(consentStates)
      .where(eq(consentStates.patientId, other?.id ?? ''));
    expect(row).toMatchObject({ state: 'granted', derivationVersion: '1' });
  });
});
