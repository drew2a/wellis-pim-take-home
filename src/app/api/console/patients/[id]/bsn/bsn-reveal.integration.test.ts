// Revealing a bsn writes before it reads (ADR-0023 item 8): the number is available to the care
// team, and every look at it is on the record.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { auditEntries, patients, reviewers } from '@/db/schema';
import { loadEnv } from '@/env';
import { createTestDatabase, type TestDatabase, type TestDb } from '@/test/database';
import { patientRow } from '@/test/rows';

const holder = vi.hoisted((): { db: unknown } => ({ db: undefined }));
vi.mock('@/db/client', () => ({ getDb: () => holder.db }));

const SECRET = loadEnv().CONSOLE_SECRET;

const { POST: reveal } = await import('./route');
const { SESSION_COOKIE, signSession } = await import('@/console/session');

let database: TestDatabase;
let db: TestDb;
let reviewerId: string;
let patientId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  holder.db = db;
  await database.migrate();
}, 60_000);

afterAll(async () => {
  await database.drop();
});

beforeEach(async () => {
  await database.truncateAll();
  const [reviewer] = await db
    .insert(reviewers)
    .values({ name: 'Sanne Bakker', role: 'ops' })
    .returning({ id: reviewers.id });
  reviewerId = reviewer?.id ?? '';
  const [patient] = await db
    .insert(patients)
    .values({ ...patientRow(), bsn: '111222333', bsnCheck: 'valid' })
    .returning({ id: patients.id });
  patientId = patient?.id ?? '';
});

const post = (id: string, session = true): Promise<Response> =>
  reveal(
    new Request(`http://localhost/api/console/patients/${id}/bsn`, {
      method: 'POST',
      headers: session
        ? { cookie: `${SESSION_COOKIE}=${signSession(reviewerId, new Date(), SECRET)}` }
        : {},
    }),
    { params: Promise.resolve({ id }) },
  );

const entries = () => db.select().from(auditEntries).where(eq(auditEntries.entityId, patientId));

describe('revealing a bsn', () => {
  it('answers with the number and records who looked', async () => {
    const response = await post(patientId);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ bsn: '111222333' });

    const written = await entries();
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      actor: 'Sanne Bakker',
      actorReviewerId: reviewerId,
      entityType: 'patient',
      reason: 'bsn revealed',
      fromState: null,
      toState: null,
    });
  });

  // Each look is its own event, so the record says how often as well as by whom.
  it('records every look, not only the first', async () => {
    await post(patientId);
    await post(patientId);
    expect(await entries()).toHaveLength(2);
  });

  it('answers 401 without a session, and records nothing', async () => {
    expect((await post(patientId, false)).status).toBe(401);
    expect(await entries()).toHaveLength(0);
  });

  it('answers 404 for a patient that does not exist, and records nothing', async () => {
    const response = await post('00000000-0000-4000-8000-000000000000');
    expect(response.status).toBe(404);
    expect(await db.select().from(auditEntries)).toHaveLength(0);
  });

  it('answers null for a patient who has no number, and still records the look', async () => {
    await db
      .update(patients)
      .set({ bsn: null, bsnCheck: 'absent' })
      .where(eq(patients.id, patientId));
    await expect((await post(patientId)).json()).resolves.toEqual({ bsn: null });
    expect(await entries()).toHaveLength(1);
  });
});
