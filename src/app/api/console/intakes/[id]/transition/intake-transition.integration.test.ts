// The routes that finally offer edges 5 to 10 of ADR-0014. The machine and its guards are tested
// in src/intake; what is tested here is that the console reaches them with the session's reviewer
// as the actor, and that every refusal arrives as a status code with the machine's own words.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { auditEntries, eligibilityEvaluations, intakes, reviewers } from '@/db/schema';
import { loadEnv } from '@/env';
import { createTestDatabase, type TestDatabase, type TestDb } from '@/test/database';
import { eligibilityEvaluationRow, intakeRow } from '@/test/rows';

const holder = vi.hoisted((): { db: unknown } => ({ db: undefined }));
vi.mock('@/db/client', () => ({ getDb: () => holder.db }));

const SECRET = loadEnv().CONSOLE_SECRET;

const { POST: move } = await import('./route');
const { SESSION_COOKIE, signSession } = await import('@/console/session');

let database: TestDatabase;
let db: TestDb;
let doctor: string;
let ops: string;

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
  const seeded = await db
    .insert(reviewers)
    .values([
      { name: 'Dr Vermeer', role: 'doctor' },
      { name: 'Sanne Bakker', role: 'ops' },
    ])
    .returning({ id: reviewers.id, role: reviewers.role });
  doctor = seeded.find((row) => row.role === 'doctor')?.id ?? '';
  ops = seeded.find((row) => row.role === 'ops')?.id ?? '';
});

const post = (id: string, body: unknown, reviewerId: string | null = doctor): Promise<Response> =>
  move(
    new Request(`http://localhost/api/console/intakes/${id}/transition`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers:
        reviewerId === null
          ? {}
          : { cookie: `${SESSION_COOKIE}=${signSession(reviewerId, new Date(), SECRET)}` },
    }),
    { params: Promise.resolve({ id }) },
  );

/** A new-flow intake walked to `state` through the machine's own edges, as the trigger requires. */
async function intake(
  state: 'auto_flagged' | 'auto_rejected' | 'legacy_pending',
  matched: string[] = [],
): Promise<string> {
  const legacy = state === 'legacy_pending';
  const [row] = await db
    .insert(intakes)
    .values(
      legacy
        ? { ...intakeRow('INT-0001'), state: 'legacy_pending' }
        : {
            medicationReport: 'not_answered',
            conditionReport: 'not_answered',
            outcome: 'pending',
            state: 'draft',
          },
    )
    .returning({ id: intakes.id });
  const id = row?.id ?? '';
  if (!legacy) {
    for (const next of ['submitted', state] as const) {
      await db.update(intakes).set({ state: next }).where(eq(intakes.id, id));
    }
  }
  await db.insert(eligibilityEvaluations).values(
    eligibilityEvaluationRow(id, {
      matched: matched as never,
      engineOutcome: state === 'auto_rejected' ? 'auto_rejected' : 'auto_flagged',
      shadow: false,
    }),
  );
  return id;
}

const stateOf = async (id: string) => {
  const [row] = await db.select().from(intakes).where(eq(intakes.id, id));
  return row?.state;
};

const entriesFor = (id: string) =>
  db.select().from(auditEntries).where(eq(auditEntries.entityId, id));

describe('without a session', () => {
  it('answers 401 and moves nothing', async () => {
    const id = await intake('auto_flagged');
    expect((await post(id, { to: 'in_review' }, null)).status).toBe(401);
    expect(await stateOf(id)).toBe('auto_flagged');
  });
});

describe('claiming an intake', () => {
  it('moves it into in_review with the reviewer as the actor', async () => {
    const id = await intake('auto_flagged');
    expect((await post(id, { to: 'in_review' }, ops)).status).toBe(200);
    expect(await stateOf(id)).toBe('in_review');

    const entries = await entriesFor(id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actor: 'Sanne Bakker',
      actorReviewerId: ops,
      fromState: 'auto_flagged',
      toState: 'in_review',
      // A human decision is a new event and must never collide with another (ADR-0008 item 1).
      dedupeKey: null,
    });
  });

  // Triage is open to both roles; only the medical decision is not (ADR-0014 item 3).
  it('is open to an ops reviewer', async () => {
    const id = await intake('auto_rejected');
    expect((await post(id, { to: 'in_review' }, ops)).status).toBe(200);
  });

  // Exclusive claiming falls out of the acyclic graph: in_review → in_review is not an edge.
  it('cannot be done twice', async () => {
    const id = await intake('auto_flagged');
    await post(id, { to: 'in_review' }, ops);
    const second = await post(id, { to: 'in_review' }, doctor);
    expect(second.status).toBe(409);
    expect(await entriesFor(id)).toHaveLength(1);
  });

  it('opens the one legacy state that has a door', async () => {
    const id = await intake('legacy_pending');
    expect((await post(id, { to: 'in_review' }, doctor)).status).toBe(200);
  });

  it('is refused for a legacy state that has none', async () => {
    const [row] = await db
      .insert(intakes)
      .values({ ...intakeRow('INT-0002'), state: 'legacy_approved' })
      .returning({ id: intakes.id });
    const response = await post(row?.id ?? '', { to: 'in_review' });
    expect(response.status).toBe(409);
    expect(await stateOf(row?.id ?? '')).toBe('legacy_approved');
  });
});

describe('approving and rejecting', () => {
  async function claimed(matched: string[] = []): Promise<string> {
    const id = await intake('auto_flagged', matched);
    await post(id, { to: 'in_review' }, doctor);
    return id;
  }

  it('needs a note', async () => {
    const id = await claimed();
    expect((await post(id, { to: 'approved', note: '  ' })).status).toBe(400);
    expect(await stateOf(id)).toBe('in_review');
  });

  it('records the doctor’s own words as the reason', async () => {
    const id = await claimed();
    expect((await post(id, { to: 'approved', note: 'BMI and history reviewed' })).status).toBe(200);
    expect(await stateOf(id)).toBe('approved');

    const entries = await entriesFor(id);
    expect(entries.at(-1)).toMatchObject({
      actor: 'Dr Vermeer',
      actorReviewerId: doctor,
      fromState: 'in_review',
      toState: 'approved',
      reason: 'BMI and history reviewed',
    });
  });

  // The one place the seeded role decides something (ADR-0014 item 3).
  it.each(['approved', 'rejected'] as const)('is refused to an ops reviewer for %s', async (to) => {
    const id = await claimed();
    const response = await post(id, { to, note: 'looks fine to me' }, ops);
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('doctor');
    expect(await stateOf(id)).toBe('in_review');
    expect(await entriesFor(id)).toHaveLength(1);
  });
});

// Q1 makes the age rule absolute because it is a legal gate a reviewer cannot resolve in the
// patient's favour, so approval is the one edge it closes (ADR-0014 item 3).
describe('an intake the rules rejected absolutely', () => {
  async function minor(): Promise<string> {
    const id = await intake('auto_rejected', ['age_below_minimum']);
    await post(id, { to: 'in_review' }, doctor);
    return id;
  }

  it('cannot be approved, by anyone, and the refusal says which rule', async () => {
    const id = await minor();
    const response = await post(id, { to: 'approved', note: 'the parents consented' });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('age_below_minimum');
    expect(await stateOf(id)).toBe('in_review');
  });

  it('can still be rejected, so the reviewer has a decision to take', async () => {
    const id = await minor();
    expect((await post(id, { to: 'rejected', note: 'under 18 at submission' })).status).toBe(200);
    expect(await stateOf(id)).toBe('rejected');
  });

  // An intake in in_review with no stored evaluation cannot be judged, so it throws rather than
  // failing open (ADR-0014 item 3).
  it('cannot be approved when nothing says what the rules found', async () => {
    const [row] = await db
      .insert(intakes)
      .values({
        medicationReport: 'not_answered',
        conditionReport: 'not_answered',
        outcome: 'pending',
        state: 'draft',
      })
      .returning({ id: intakes.id });
    const id = row?.id ?? '';
    for (const next of ['submitted', 'auto_flagged'] as const) {
      await db.update(intakes).set({ state: next }).where(eq(intakes.id, id));
    }
    await post(id, { to: 'in_review' }, doctor);

    const response = await post(id, { to: 'approved', note: 'looks fine' });
    expect(response.status).toBe(403);
    expect(await stateOf(id)).toBe('in_review');
  });
});
