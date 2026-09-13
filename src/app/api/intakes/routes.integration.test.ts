// The intake routes (ADR-0015 item 3). The handlers are called directly with a `Request`, which is
// what Next hands them, so the test covers the status codes and the messages a patient actually
// sees — including the plausibility and age bounds, which are the form's only real validation.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONSENT_TEXT_VERSION } from '@/consent/text';
import { auditEntries, intakes } from '@/db/schema';
import type { IntakeStep } from '@/intake/answers';
import { createTestDatabase, type TestDatabase, type TestDb } from '@/test/database';

// The routes reach for the process-wide pool; the test has its own database per file.
const holder = vi.hoisted((): { db: unknown } => ({ db: undefined }));
vi.mock('@/db/client', () => ({ getDb: () => holder.db }));

const { POST: createDraft } = await import('./route');
const { GET: readIntake, PATCH: saveStep } = await import('./[id]/route');
const { POST: submitIntake } = await import('./[id]/submit/route');

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

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const patch = (id: string, step: IntakeStep, answers: unknown): Promise<Response> =>
  saveStep(
    new Request('http://localhost/api/intakes', {
      method: 'PATCH',
      body: JSON.stringify({ step, answers }),
    }),
    params(id),
  );

async function newDraft(): Promise<string> {
  const response = await createDraft();
  const body = (await response.json()) as { id: string };
  return body.id;
}

const STEPS: Record<IntakeStep, unknown> = {
  identity: { fullName: 'Sem de Boer', email: 'sem@example.com', dob: '1986-04-02' },
  metrics: { heightCm: 180, weightKg: 101 },
  medications: { glp1Declared: false, glp1: [], otherMedications: '' },
  conditions: { conditions: [], otherConditions: '' },
  consent: { granted: true, textVersion: CONSENT_TEXT_VERSION },
};

async function fillIn(id: string, skip: IntakeStep[] = []): Promise<void> {
  for (const [step, answers] of Object.entries(STEPS) as [IntakeStep, unknown][]) {
    if (skip.includes(step)) continue;
    const response = await patch(id, step, answers);
    if (response.status !== 200) {
      throw new Error(`saving ${step} failed: ${await response.text()}`);
    }
  }
}

const issues = async (response: Response): Promise<{ path: string; message: string }[]> => {
  const body = (await response.json()) as { issues?: { path: string; message: string }[] };
  return body.issues ?? [];
};

describe('POST /api/intakes', () => {
  it('creates a draft and records that it was created', async () => {
    const response = await createDraft();
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; state: string };
    expect(body.state).toBe('draft');

    const [row] = await db.select().from(intakes).where(eq(intakes.id, body.id));
    expect(row).toMatchObject({
      state: 'draft',
      medicationReport: 'not_answered',
      conditionReport: 'not_answered',
      outcome: 'pending',
      patientId: null,
    });

    const [entry] = await db.select().from(auditEntries).where(eq(auditEntries.entityId, body.id));
    expect(entry).toMatchObject({ actor: 'intake form', fromState: null, toState: 'draft' });
  });
});

describe('PATCH /api/intakes/:id', () => {
  it('saves a step without moving the intake or writing an audit entry', async () => {
    const id = await newDraft();
    const before = await db.select().from(auditEntries).where(eq(auditEntries.entityId, id));

    const response = await patch(id, 'identity', STEPS.identity);

    expect(response.status).toBe(200);
    const [row] = await db.select().from(intakes).where(eq(intakes.id, id));
    expect(row?.state).toBe('draft');
    expect(row?.answers?.identity).toEqual(STEPS.identity);
    expect(await db.select().from(auditEntries).where(eq(auditEntries.entityId, id))).toHaveLength(
      before.length,
    );
  });

  it.each([
    [
      'a height below the bound',
      { heightCm: 99, weightKg: 101 },
      'heightCm',
      'between 100 and 230',
    ],
    ['a height above it', { heightCm: 231, weightKg: 101 }, 'heightCm', 'between 100 and 230'],
    [
      'a weight below the bound',
      { heightCm: 180, weightKg: 29.9 },
      'weightKg',
      'between 30 and 300',
    ],
    ['a weight above it', { heightCm: 180, weightKg: 300.1 }, 'weightKg', 'between 30 and 300'],
  ])('refuses %s with a message naming it', async (_name, answers, field, message) => {
    const response = await patch(await newDraft(), 'metrics', answers);
    expect(response.status).toBe(400);
    expect(await issues(response)).toContainEqual(
      expect.objectContaining({
        path: field,
        message: expect.stringContaining(message) as unknown,
      }),
    );
  });

  it.each([
    [100, 230],
    [30, 300],
  ])('accepts the bounds themselves', async (low, high) => {
    const heights = low === 100 ? [low, high] : [180, 180];
    const weights = low === 100 ? [101, 101] : [low, high];
    for (const [index, heightCm] of heights.entries()) {
      const response = await patch(await newDraft(), 'metrics', {
        heightCm,
        weightKg: weights[index],
      });
      expect(response.status).toBe(200);
    }
  });

  it('refuses a date of birth that is in the future or implies an age above 100', async () => {
    const future = await patch(await newDraft(), 'identity', {
      ...(STEPS.identity as object),
      dob: '2999-01-01',
    });
    expect(future.status).toBe(400);
    expect(await issues(future)).toContainEqual(
      expect.objectContaining({
        path: 'dob',
        message: expect.stringContaining('in the past') as unknown,
      }),
    );

    const old = await patch(await newDraft(), 'identity', {
      ...(STEPS.identity as object),
      dob: '1900-01-01',
    });
    expect(old.status).toBe(400);
    expect(await issues(old)).toContainEqual(
      expect.objectContaining({
        path: 'dob',
        message: expect.stringContaining('at most 100') as unknown,
      }),
    );
  });

  it('refuses an unparseable body, an unknown step and a malformed id', async () => {
    const id = await newDraft();
    const notJson = await saveStep(
      new Request('http://localhost/api/intakes', { method: 'PATCH', body: 'not json' }),
      params(id),
    );
    expect(notJson.status).toBe(400);

    expect((await patch(id, 'nonsense' as IntakeStep, {})).status).toBe(400);
    expect((await patch('not-a-uuid', 'identity', STEPS.identity)).status).toBe(404);
    expect(
      (await patch('00000000-0000-4000-8000-000000000000', 'identity', STEPS.identity)).status,
    ).toBe(404);
  });

  it('refuses to change an intake that has already been submitted', async () => {
    const id = await newDraft();
    await fillIn(id);
    expect((await submitIntake(new Request('http://x'), params(id))).status).toBe(200);

    const response = await patch(id, 'metrics', { heightCm: 170, weightKg: 60 });
    expect(response.status).toBe(409);
  });
});

describe('POST /api/intakes/:id/submit', () => {
  const submit = (id: string) => submitIntake(new Request('http://x'), params(id));

  it('submits a complete answer set and tells the patient what the rules found', async () => {
    const id = await newDraft();
    await fillIn(id);

    const response = await submit(id);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id,
      state: 'auto_cleared',
      outcome: 'auto_cleared',
      reasons: ['cleared: no rejecting or flagging rule matched'],
      rulesetVersion: 'v1',
    });
  });

  it('refuses a submission without consent, and leaves the draft a draft', async () => {
    const id = await newDraft();
    await fillIn(id, ['consent']);

    const response = await submit(id);

    expect(response.status).toBe(400);
    expect(await issues(response)).toContainEqual(expect.objectContaining({ path: 'consent' }));
    const [row] = await db.select().from(intakes).where(eq(intakes.id, id));
    expect(row?.state).toBe('draft');
  });

  it('refuses an incomplete submission, naming every step still missing', async () => {
    const id = await newDraft();
    await fillIn(id, ['metrics', 'conditions']);

    const response = await submit(id);

    expect(response.status).toBe(400);
    expect((await issues(response)).map((issue) => issue.path).sort()).toEqual([
      'conditions',
      'metrics',
    ]);
  });

  it('is 409 the second time and 404 for an intake that does not exist', async () => {
    const id = await newDraft();
    await fillIn(id);
    await submit(id);
    expect((await submit(id)).status).toBe(409);
    expect((await submit('00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });
});

describe('GET /api/intakes/:id', () => {
  it('returns a draft’s answers, and after submission the evaluation too', async () => {
    const id = await newDraft();
    await fillIn(id);

    const asDraft = (await (await readIntake(new Request('http://x'), params(id))).json()) as {
      state: string;
      evaluation: unknown;
    };
    expect(asDraft).toMatchObject({ state: 'draft', evaluation: null });

    await submitIntake(new Request('http://x'), params(id));
    const afterwards = (await (await readIntake(new Request('http://x'), params(id))).json()) as {
      state: string;
      evaluation: { engineOutcome: string; reasons: string[] };
    };
    expect(afterwards.state).toBe('auto_cleared');
    expect(afterwards.evaluation.engineOutcome).toBe('auto_cleared');
  });

  it('is 404 for an unknown or malformed id', async () => {
    expect((await readIntake(new Request('http://x'), params('not-a-uuid'))).status).toBe(404);
    expect(
      (await readIntake(new Request('http://x'), params('00000000-0000-4000-8000-000000000000')))
        .status,
    ).toBe(404);
  });
});
