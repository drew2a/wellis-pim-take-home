// Signing in and out (ADR-0021). The handlers are called directly with a `Request`, so these are
// the status codes, the messages and the `Set-Cookie` a reviewer's browser actually gets.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { unauthorized } from '@/app/api/http';
import { reviewers } from '@/db/schema';
import { loadEnv } from '@/env';
import { createTestDatabase, type TestDatabase, type TestDb } from '@/test/database';

const holder = vi.hoisted((): { db: unknown } => ({ db: undefined }));
vi.mock('@/db/client', () => ({ getDb: () => holder.db }));

const SECRET = loadEnv().CONSOLE_SECRET;

const { DELETE: signOut, POST: signIn } = await import('./route');
const { currentReviewer } = await import('@/console/reviewer');
const { SESSION_COOKIE } = await import('@/console/session');

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

async function seed(name: string): Promise<string> {
  const [row] = await db.insert(reviewers).values({ name }).returning({ id: reviewers.id });
  if (row === undefined) throw new Error('the reviewer was not seeded');
  return row.id;
}

const post = (body: unknown): Promise<Response> =>
  signIn(
    new Request('http://localhost/api/console/session', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

/** The cookie a response sets, without its attributes. */
const cookieValue = (response: Response): string | undefined => {
  const header = response.headers.get('set-cookie');
  return header?.split(';')[0]?.split('=')[1];
};

describe('POST /api/console/session', () => {
  it('signs a reviewer in and hands back a session their next request is accepted with', async () => {
    const reviewerId = await seed('Dr Vermeer');
    const response = await post({ reviewerId, secret: SECRET });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: reviewerId, name: 'Dr Vermeer' });

    const value = cookieValue(response);
    expect(value).toBeDefined();
    const next = new Request('http://localhost/api/console/queue', {
      headers: { cookie: `${SESSION_COOKIE}=${value ?? ''}` },
    });
    await expect(currentReviewer(next)).resolves.toMatchObject({ id: reviewerId });
  });

  it('sets the session httpOnly, same-site and scoped to the console', async () => {
    const reviewerId = await seed('Dr Vermeer');
    const header = (await post({ reviewerId, secret: SECRET })).headers.get('set-cookie') ?? '';
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
  });

  it('refuses a wrong secret and sets nothing', async () => {
    const reviewerId = await seed('Dr Vermeer');
    const response = await post({ reviewerId, secret: 'z'.repeat(SECRET.length) });
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  // A login page that said "no such reviewer" would enumerate the care team for anyone with the
  // URL, so the two failures are one answer.
  it('refuses an unknown reviewer with the same answer as a wrong secret', async () => {
    const reviewerId = await seed('Dr Vermeer');
    const unknown = await post({
      reviewerId: '00000000-0000-4000-8000-000000000000',
      secret: SECRET,
    });
    const wrongSecret = await post({ reviewerId, secret: 'z'.repeat(SECRET.length) });
    expect(unknown.status).toBe(401);
    expect(wrongSecret.status).toBe(401);
    await expect(unknown.json()).resolves.toEqual(await wrongSecret.json());
  });

  // `unauthorized()` sends a caller with no session to the login page. On the login page itself
  // that sentence tells the reviewer to do what they are doing, so this route has its own text.
  it('tells a refused reviewer the attempt failed, not to go and sign in', async () => {
    const reviewerId = await seed('Dr Vermeer');
    const redirectSentence = ((await unauthorized().json()) as { error: string }).error;

    for (const body of [
      { reviewerId, secret: 'z'.repeat(SECRET.length) },
      { reviewerId: '00000000-0000-4000-8000-000000000000', secret: SECRET },
    ]) {
      const refusal = (await (await post(body)).json()) as { error: string };
      expect(refusal.error).not.toBe(redirectSentence);
      expect(refusal.error).not.toBe('');
    }
  });

  // The whole reason the session exists: the caller may not say who they are or what they may do.
  it('refuses a body that tries to declare anything but a reviewer and a secret', async () => {
    const reviewerId = await seed('Sanne Bakker');
    const response = await post({ reviewerId, secret: SECRET, role: 'doctor' });
    expect(response.status).toBe(400);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it.each([
    ['a body that is not JSON', 'not json'],
    ['a missing reviewer', { secret: SECRET }],
    ['a missing secret', { reviewerId: '00000000-0000-4000-8000-000000000000' }],
    ['a reviewer id that is not a uuid', { reviewerId: 'Dr Vermeer', secret: SECRET }],
  ])('refuses %s', async (_name, body) => {
    expect((await post(body)).status).toBe(400);
  });

  it('never echoes the secret back, right or wrong', async () => {
    const reviewerId = await seed('Dr Vermeer');
    const ok = await (await post({ reviewerId, secret: SECRET })).text();
    const bad = await (await post({ reviewerId, secret: 'wrong' })).text();
    expect(ok).not.toContain(SECRET);
    expect(bad).not.toContain('wrong');
  });
});

describe('DELETE /api/console/session', () => {
  it('clears the session cookie immediately', () => {
    const response = signOut();
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('leaves nobody signed in', async () => {
    const value = cookieValue(signOut()) ?? '';
    const next = new Request('http://localhost/console', {
      headers: { cookie: `${SESSION_COOKIE}=${value}` },
    });
    await expect(currentReviewer(next)).resolves.toBeNull();
  });
});
