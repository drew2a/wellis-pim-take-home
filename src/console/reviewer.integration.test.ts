// `currentReviewer()` is the one helper every console page and every mutating console route calls
// (ADR-0021 item 3). These cases are what it must answer, against a real `reviewers` table: the
// role is read from the row on every request, and a session naming nobody is no session.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { reviewers } from '@/db/schema';
import { loadEnv } from '@/env';
import { createTestDatabase, type TestDatabase, type TestDb } from '@/test/database';

const holder = vi.hoisted((): { db: unknown } => ({ db: undefined }));
vi.mock('@/db/client', () => ({ getDb: () => holder.db }));

// The real one, from the environment this test run already validated: mocking `@/env` would also
// take DATABASE_URL away from the test database, and the point here is the real wiring.
const SECRET = loadEnv().CONSOLE_SECRET;

const { currentReviewer } = await import('./reviewer');
const { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, signSession } = await import('./session');

let database: TestDatabase;
let db: TestDb;

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
});

async function seed(name: string, role: 'doctor' | 'ops'): Promise<string> {
  const [row] = await db.insert(reviewers).values({ name, role }).returning({ id: reviewers.id });
  if (row === undefined) throw new Error('the reviewer was not seeded');
  return row.id;
}

const withSession = (value: string): Request =>
  new Request('http://localhost/api/console/anything', {
    headers: { cookie: `${SESSION_COOKIE}=${value}` },
  });

const signedFor = (id: string, at = new Date()): Request =>
  withSession(signSession(id, at, SECRET));

describe('currentReviewer', () => {
  it('is the reviewer the session names', async () => {
    const id = await seed('Dr Vermeer', 'doctor');
    await expect(currentReviewer(signedFor(id))).resolves.toEqual({
      id,
      name: 'Dr Vermeer',
      role: 'doctor',
    });
  });

  it('is nobody without a cookie at all', async () => {
    await expect(currentReviewer(new Request('http://localhost/'))).resolves.toBeNull();
  });

  it('is nobody when the signature does not verify', async () => {
    const id = await seed('Sanne Bakker', 'ops');
    await expect(
      currentReviewer(withSession(signSession(id, new Date(), 'a'.repeat(32)))),
    ).resolves.toBeNull();
  });

  it('is nobody when the session has expired', async () => {
    const id = await seed('Sanne Bakker', 'ops');
    const issued = new Date(Date.now() - (SESSION_MAX_AGE_SECONDS + 1) * 1000);
    await expect(currentReviewer(signedFor(id, issued))).resolves.toBeNull();
  });

  // The row is the identity: a seed that removed someone must not leave their session working.
  it('is nobody when the reviewer has been removed', async () => {
    const id = await seed('Dr Vermeer', 'doctor');
    const request = signedFor(id);
    await db.delete(reviewers).where(eq(reviewers.id, id));
    await expect(currentReviewer(request)).resolves.toBeNull();
  });

  // The cookie carries no role, so this is the only place a role can come from (ADR-0021 item 2).
  it('reads the role from the row, so a re-seeded role takes effect on the next request', async () => {
    const id = await seed('Sanne Bakker', 'ops');
    const request = signedFor(id);
    await expect(currentReviewer(request)).resolves.toMatchObject({ role: 'ops' });
    await db.update(reviewers).set({ role: 'doctor' }).where(eq(reviewers.id, id));
    await expect(currentReviewer(request)).resolves.toMatchObject({ role: 'doctor' });
  });

  it('is nobody when the session names a uuid that was never a reviewer', async () => {
    await seed('Dr Vermeer', 'doctor');
    await expect(
      currentReviewer(signedFor('00000000-0000-4000-8000-000000000000')),
    ).resolves.toBeNull();
  });
});
