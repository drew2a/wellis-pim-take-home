// The one route every review-item action goes through (ADR-0023). Called directly with a
// `Request`, so these are the status codes a reviewer's browser gets — and the writes the database
// ends up with.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { auditEntries, patients, reviewItems, reviewers } from '@/db/schema';
import { loadEnv } from '@/env';
import { createTestDatabase, type TestDatabase, type TestDb } from '@/test/database';
import { patientRow, reviewItemRow } from '@/test/rows';

const holder = vi.hoisted((): { db: unknown } => ({ db: undefined }));
vi.mock('@/db/client', () => ({ getDb: () => holder.db }));

const SECRET = loadEnv().CONSOLE_SECRET;

const { POST: resolveItem } = await import('./route');
const { SESSION_COOKIE, signSession } = await import('@/console/session');

let database: TestDatabase;
let db: TestDb;
let reviewerId: string;

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
  const [row] = await db
    .insert(reviewers)
    .values({ name: 'Sanne Bakker', role: 'ops' })
    .returning({ id: reviewers.id });
  reviewerId = row?.id ?? '';
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const post = (id: string, body: unknown, session = true): Promise<Response> =>
  resolveItem(
    new Request(`http://localhost/api/console/items/${id}/resolve`, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: session
        ? { cookie: `${SESSION_COOKIE}=${signSession(reviewerId, new Date(), SECRET)}` }
        : {},
    }),
    params(id),
  );

async function patient(legacyId: string, weightKg: string | null): Promise<string> {
  const [row] = await db
    .insert(patients)
    .values({ ...patientRow(), createdFromLegacyId: legacyId, weightKg })
    .returning({ id: patients.id });
  return row?.id ?? '';
}

async function item(overrides: Partial<typeof reviewItems.$inferInsert>): Promise<string> {
  const [row] = await db
    .insert(reviewItems)
    .values({ ...reviewItemRow(`key-${Math.random()}`), ...overrides })
    .returning({ id: reviewItems.id });
  return row?.id ?? '';
}

const vocabularyItem = (rule: string, payload: unknown) =>
  item({
    type: 'vocabulary',
    scope: 'vocabulary',
    title: 'a question about the whole vocabulary',
    payload: payload,
    dedupeKey: `vocabulary|vocabulary|legacy_patient|weight_kg|${rule}|`,
  });

describe('without a session', () => {
  it('answers 401 and writes nothing', async () => {
    const id = await vocabularyItem('DATE_ORDER_FROM_SEPARATOR', {});
    const response = await post(id, { action: 'confirm', note: 'yes' }, false);
    expect(response.status).toBe(401);
    const [row] = await db.select().from(reviewItems).where(eq(reviewItems.id, id));
    expect(row?.status).toBe('open');
  });

  // The 401 comes before the body is read, so an unauthenticated caller learns nothing about what
  // the route would have accepted.
  it('answers 401 even for a body the route would refuse', async () => {
    const id = await vocabularyItem('DATE_ORDER_FROM_SEPARATOR', {});
    expect((await post(id, { nonsense: true }, false)).status).toBe(401);
  });
});

describe('resolving a vocabulary item', () => {
  it('records a confirmation against the item', async () => {
    const id = await vocabularyItem('DATE_ORDER_FROM_SEPARATOR', { evidence: {} });
    const response = await post(id, { action: 'confirm', note: '1479 values, 0 counterexamples' });
    expect(response.status).toBe(200);

    const [row] = await db.select().from(reviewItems).where(eq(reviewItems.id, id));
    expect(row).toMatchObject({
      status: 'resolved',
      resolvedBy: 'Sanne Bakker',
      resolutionNote: '1479 values, 0 counterexamples',
    });
    expect(row?.resolution).toMatchObject({ action: 'confirm' });

    const entries = await db.select().from(auditEntries).where(eq(auditEntries.entityId, id));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorReviewerId: reviewerId, entityType: 'review_item' });
  });

  it('needs a note', async () => {
    const id = await vocabularyItem('DATE_ORDER_FROM_SEPARATOR', {});
    expect((await post(id, { action: 'confirm', note: '   ' })).status).toBe(400);
  });

  it('refuses a body that names the rows to write', async () => {
    const id = await vocabularyItem('DATE_ORDER_FROM_SEPARATOR', {});
    const response = await post(id, {
      action: 'confirm',
      note: 'ok',
      changes: [{ entityType: 'patient', entityId: reviewerId, field: 'bsn', value: null }],
    });
    expect(response.status).toBe(400);
  });

  it('refuses a second decision on the same item', async () => {
    const id = await vocabularyItem('DATE_ORDER_FROM_SEPARATOR', {});
    await post(id, { action: 'confirm', note: 'yes' });
    expect((await post(id, { action: 'reject', note: 'no' })).status).toBe(409);
  });

  it('answers 404 for an item that does not exist', async () => {
    const response = await post('00000000-0000-4000-8000-000000000000', {
      action: 'confirm',
      note: 'yes',
    });
    expect(response.status).toBe(404);
  });
});

describe('applying the 18 unit-less weights', () => {
  const rows = (...legacyIds: readonly string[]) => ({
    rows: legacyIds.map((legacyId, index) => ({
      legacy_id: legacyId,
      raw_weight: '168.2',
      as_pounds: { weight_kg: `7${index}.3`, bmi: 26.1 },
      as_kilograms: { weight_kg: '168.2', bmi: 57.5 },
    })),
  });

  it('writes the pounds reading to every row, and one audit entry per row', async () => {
    const first = await patient('recA', null);
    const second = await patient('recB', null);
    const id = await vocabularyItem('WEIGHT_UNIT_MISSING_TO_NULL', rows('recA', 'recB'));

    const response = await post(id, { action: 'confirm', note: 'both reconcile with the intakes' });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ changed: 2 });

    const rowsAfter = await db.select().from(patients);
    expect(rowsAfter.map((row) => row.weightKg).sort()).toEqual(['70.3', '71.3']);
    expect(
      await db.select().from(auditEntries).where(eq(auditEntries.entityId, first)),
    ).toHaveLength(1);
    expect(
      await db.select().from(auditEntries).where(eq(auditEntries.entityId, second)),
    ).toHaveLength(1);
  });

  it('leaves out the rows the reviewer excluded', async () => {
    const kept = await patient('recA', null);
    const excluded = await patient('recB', null);
    const id = await vocabularyItem('WEIGHT_UNIT_MISSING_TO_NULL', rows('recA', 'recB'));

    await post(id, {
      action: 'confirm',
      note: 'the second does not reconcile',
      excluded: ['recB'],
    });

    const [keptRow] = await db.select().from(patients).where(eq(patients.id, kept));
    const [excludedRow] = await db.select().from(patients).where(eq(patients.id, excluded));
    expect(keptRow?.weightKg).toBe('70.3');
    expect(excludedRow?.weightKg).toBeNull();
    expect(await db.select().from(auditEntries).where(eq(auditEntries.entityId, excluded))).toEqual(
      [],
    );
  });

  it('refuses an exclusion that is not one of the item’s rows, and writes nothing', async () => {
    await patient('recA', null);
    const id = await vocabularyItem('WEIGHT_UNIT_MISSING_TO_NULL', rows('recA'));
    const response = await post(id, { action: 'confirm', note: 'ok', excluded: ['recZ'] });
    expect(response.status).toBe(400);
    const [row] = await db.select().from(patients);
    expect(row?.weightKg).toBeNull();
  });

  it('writes nothing when the answer is no', async () => {
    await patient('recA', null);
    const id = await vocabularyItem('WEIGHT_UNIT_MISSING_TO_NULL', rows('recA'));
    await post(id, { action: 'reject', note: 'they are kilograms after all' });
    const [row] = await db.select().from(patients);
    expect(row?.weightKg).toBeNull();
  });
});

describe('an item type whose screen is not built', () => {
  it('is refused rather than half-resolved', async () => {
    const id = await item({
      type: 'consent',
      field: 'consent_state',
      dedupeKey: 'consent|row|legacy_patient:recA|data_processing|CONSENT_REVOKED_WHILE_ACTIVE|x',
    });
    const response = await post(id, { action: 'confirm', note: 'ok' });
    expect(response.status).toBe(400);
    const [row] = await db.select().from(reviewItems).where(eq(reviewItems.id, id));
    expect(row?.status).toBe('open');
  });
});
