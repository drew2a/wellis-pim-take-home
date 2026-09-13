// The intake routes (ADR-0015 item 3). The handlers are called directly with a `Request`, which is
// what Next hands them, so the test covers the status codes and the messages a patient actually
// sees — including the plausibility and age bounds, which are the form's only real validation.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import IntakePage from '@/app/intake/page';
import { CONSENT_TEXT_VERSION } from '@/consent/text';
import { auditEntries, eligibilityEvaluations, intakes } from '@/db/schema';
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

const post = (body: string): Promise<Response> =>
  createDraft(new Request('http://localhost/api/intakes', { method: 'POST', body }));

async function newDraft(): Promise<string> {
  const response = await post(JSON.stringify(STEPS.consent));
  if (response.status !== 201) throw new Error(`creating a draft failed: ${await response.text()}`);
  const body = (await response.json()) as { id: string };
  return body.id;
}

// In the order the patient walks through them (ADR-0019), which is also the order `fillIn` saves.
const STEPS: Record<IntakeStep, unknown> = {
  consent: { granted: true, textVersion: CONSENT_TEXT_VERSION },
  identity: { fullName: 'Sem de Boer', email: 'sem@example.com', dob: '1986-04-02' },
  metrics: { heightCm: 180, weightKg: 101 },
  medications: { glp1Declared: false, glp1: [], otherMedications: '' },
  conditions: { conditions: [], otherConditions: '' },
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
  it('creates a draft from the first step and records that it was created', async () => {
    const response = await post(JSON.stringify(STEPS.consent));
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
    // The first step is saved by the same request that creates the row (ADR-0016 item 1), and the
    // first step is consent (ADR-0019): no health data has been sent yet.
    expect(row?.answers?.consent).toEqual(STEPS.consent);
    expect(row?.answers?.identity).toBeUndefined();

    const [entry] = await db.select().from(auditEntries).where(eq(auditEntries.entityId, body.id));
    expect(entry).toMatchObject({ actor: 'intake form', fromState: null, toState: 'draft' });
  });

  // A page view is not an intake (ADR-0016): rendering the page is what a crawler, a link preview
  // and every refresh do, and none of them has answered a question.
  it('writes nothing when the intake page is rendered', async () => {
    IntakePage();
    expect(await db.select().from(intakes)).toHaveLength(0);
    expect(await db.select().from(auditEntries)).toHaveLength(0);
  });

  it('refuses a first step that does not validate, and writes nothing', async () => {
    const response = await post(
      JSON.stringify({ granted: true, textVersion: `not-${CONSENT_TEXT_VERSION}` }),
    );

    expect(response.status).toBe(400);
    expect(await issues(response)).toContainEqual(
      expect.objectContaining({
        path: 'textVersion',
        message: expect.stringContaining('consent text has changed') as unknown,
      }),
    );
    expect(await db.select().from(intakes)).toHaveLength(0);
  });

  // The consent gate is now the front door (ADR-0019 item 2): a patient who does not agree leaves
  // no row, no audit entry and no answers behind, because the request that would have created
  // them is the one that is refused.
  it('refuses to create a draft for a patient who does not agree, and writes nothing', async () => {
    const response = await post(
      JSON.stringify({ granted: false, textVersion: CONSENT_TEXT_VERSION }),
    );

    expect(response.status).toBe(400);
    expect(await issues(response)).toContainEqual(expect.objectContaining({ path: 'granted' }));
    expect(await db.select().from(intakes)).toHaveLength(0);
    expect(await db.select().from(auditEntries)).toHaveLength(0);
  });

  it('refuses a body that is not JSON, and writes nothing', async () => {
    expect((await post('not json')).status).toBe(400);
    expect(await db.select().from(intakes)).toHaveLength(0);
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

  // A draft with no answers is a broken invariant, not a case to default around: papering over it
  // produced a 400 naming `formVersion`, a path no step owns, so the patient saw a message with no
  // field to correct (`CLAUDE.md` §2).
  it('fails loudly rather than inventing a form version for a draft with no answers', async () => {
    const id = await newDraft();
    await db.update(intakes).set({ answers: null }).where(eq(intakes.id, id));

    const response = await patch(id, 'metrics', STEPS.metrics);

    expect(response.status).toBe(500);
    const [row] = await db.select().from(intakes).where(eq(intakes.id, id));
    expect(row?.answers).toBeNull();
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

  // Since ADR-0019 the form cannot produce an unconsented draft — consent is what creates the row.
  // The gate at submit is the server's own check and is not the form's to skip (R-B7, R-T4), so the
  // draft is stripped of its consent directly in the database to put the gate under test alone.
  it('refuses a submission without consent, and leaves the draft a draft', async () => {
    const id = await newDraft();
    await fillIn(id);
    const [before] = await db.select().from(intakes).where(eq(intakes.id, id));
    if (before?.answers === undefined || before.answers === null) {
      throw new Error('the draft under test has no answers');
    }
    const { consent, ...unconsented } = before.answers;
    expect(consent).toBeDefined();
    await db.update(intakes).set({ answers: unconsented }).where(eq(intakes.id, id));

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

  // An intake can hold more than one evaluation: every import run rewrites the shadow rows. Which
  // one the patient is shown must be the one that governs — `desc(evaluatedAt)`, non-shadow ahead
  // of shadow on a tie — and it must be the *same* one `governingMatched` picks in
  // `src/intake/transition.ts`, or the screen and the transition guard disagree about the verdict.
  //
  // Both cases are built so that an unordered query returns the wrong row: the row that should win
  // is written into the heap second, which is where a bare `select` would find it last.
  const shadowRow = (id: string, real: typeof eligibilityEvaluations.$inferSelect, at: Date) => ({
    intakeId: id,
    rulesetVersion: real.rulesetVersion,
    engineOutcome: 'auto_rejected' as const,
    reasons: ['shadow: a re-import re-judged this intake'],
    matched: [],
    inputs: real.inputs,
    evaluatedAt: at,
    shadow: true,
  });

  const evaluationOf = async (id: string): Promise<string> => {
    const body = (await (await readIntake(new Request('http://x'), params(id))).json()) as {
      evaluation: { engineOutcome: string };
    };
    return body.evaluation.engineOutcome;
  };

  const realEvaluation = async (id: string) => {
    const [row] = await db
      .select()
      .from(eligibilityEvaluations)
      .where(eq(eligibilityEvaluations.intakeId, id));
    if (row === undefined) throw new Error('the submission wrote no evaluation');
    return row;
  };

  it('shows the later evaluation when a re-import has written one', async () => {
    const id = await newDraft();
    await fillIn(id);
    await submitIntake(new Request('http://x'), params(id));
    const real = await realEvaluation(id);
    const later = new Date(real.evaluatedAt.getTime() + 60_000);

    await db.insert(eligibilityEvaluations).values(shadowRow(id, real, later));

    expect(await evaluationOf(id)).toBe('auto_rejected');
  });

  it('prefers the real evaluation to a shadow written at the same instant', async () => {
    const id = await newDraft();
    await fillIn(id);
    await submitIntake(new Request('http://x'), params(id));
    const real = await realEvaluation(id);

    // Rewritten in the opposite order — shadow first, then the real row — so that the tie on
    // `evaluatedAt` is the only thing left to break, and a query without the tie-break would
    // answer with the shadow.
    await db.delete(eligibilityEvaluations).where(eq(eligibilityEvaluations.intakeId, id));
    await db.insert(eligibilityEvaluations).values(shadowRow(id, real, real.evaluatedAt));
    await db.insert(eligibilityEvaluations).values({
      intakeId: id,
      rulesetVersion: real.rulesetVersion,
      engineOutcome: real.engineOutcome,
      reasons: real.reasons,
      matched: real.matched,
      inputs: real.inputs,
      evaluatedAt: real.evaluatedAt,
      shadow: false,
    });

    expect(await evaluationOf(id)).toBe('auto_cleared');
  });

  it('is 404 for an unknown or malformed id', async () => {
    expect((await readIntake(new Request('http://x'), params('not-a-uuid'))).status).toBe(404);
    expect(
      (await readIntake(new Request('http://x'), params('00000000-0000-4000-8000-000000000000')))
        .status,
    ).toBe(404);
  });
});

describe('cache headers', () => {
  const submit = (id: string) => submitIntake(new Request('http://x'), params(id));
  const read = (id: string) => readIntake(new Request('http://x'), params(id));
  const UNKNOWN = '00000000-0000-4000-8000-000000000000';

  it('tells every store not to keep an intake response', async () => {
    const id = await newDraft();
    await fillIn(id);

    // Success and failure alike: a 404 and a 409 answer "does this intake exist, and where has it
    // got to" — the same disclosure as the body, shorter.
    const responses = [
      await post(JSON.stringify(STEPS.consent)),
      await post('not json'),
      await read(id),
      await read(UNKNOWN),
      await patch(id, 'metrics', STEPS.metrics),
      await patch(UNKNOWN, 'metrics', STEPS.metrics),
      await submit(id),
      await submit(id),
    ];

    expect(responses.map((response) => response.headers.get('cache-control'))).toEqual(
      responses.map(() => 'no-store'),
    );
  });
});
