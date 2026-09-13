// `transitionIntake` against a real database (ADR-0014 item 5), over the same 144-pair grid the
// pure machine is tested on: every legal edge moves the intake and writes exactly one audit entry,
// every illegal one throws and leaves every table as it was.
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { auditEntries, eligibilityEvaluations, intakes, reviewers } from '@/db/schema';
import { ELIGIBILITY_ENGINE_ACTOR, INTAKE_FORM_ACTOR } from '@/import/actors';
import { createTestDatabase, type TestDatabase, type TestDb } from '@/test/database';
import { eligibilityEvaluationRow, intakeRow } from '@/test/rows';

import {
  edgeFor,
  IllegalTransitionError,
  INTAKE_STATES,
  type IntakeState,
  type TransitionActor,
} from './machine';
import { transitionIntake } from './transition';

let database: TestDatabase;
let db: TestDb;
// Two reviewers, not two roles (ADR-0027): every reviewer edge is open to both, and the tests
// below assert exactly that rather than a gate between them.
let vermeer: TransitionActor;
let bakker: TransitionActor;

const FORM: TransitionActor = { kind: 'process', name: INTAKE_FORM_ACTOR };
const ENGINE: TransitionActor = { kind: 'process', name: ELIGIBILITY_ENGINE_ACTOR };

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
  const seeded = await db
    .insert(reviewers)
    .values([{ name: 'Dr Vermeer' }, { name: 'Sanne Bakker' }])
    .returning({ id: reviewers.id, name: reviewers.name });
  const row = (name: string): TransitionActor => {
    const found = seeded.find((r) => r.name === name);
    if (found === undefined) throw new Error(`reviewer ${name} was not seeded`);
    return { kind: 'reviewer', id: found.id, name: found.name };
  };
  vermeer = row('Dr Vermeer');
  bakker = row('Sanne Bakker');
});

// A legacy intake keeps an exported key, which is unique; two of them in one test need two keys.
let legacyKeys = 0;

/** An intake in `state`, reached the only way the database allows: created, then walked there. */
async function arriveAt(state: IntakeState, options: { evaluate?: boolean } = {}): Promise<string> {
  const legacy = state.startsWith('legacy_');
  legacyKeys += 1;
  const intakeId = legacy ? `INT-${state}-${legacyKeys}` : null;
  const [created] = await db
    .insert(intakes)
    .values({ ...intakeRow(), intakeId, state: legacy ? state : 'draft' })
    .returning({ id: intakes.id });
  const id = (created as { id: string }).id;
  if (options.evaluate !== false) {
    await db.insert(eligibilityEvaluations).values(eligibilityEvaluationRow(id, { shadow: false }));
  }
  for (const [from, to] of pathTo(state)) {
    const edge = edgeFor(from, to);
    await transitionIntake(db, {
      intakeId: id,
      to,
      actor: edge?.actorKind === 'reviewer' ? vermeer : from === 'submitted' ? ENGINE : FORM,
      reason: `walking to ${state}`,
      rulesetVersion: edge?.requiresRulesetVersion === true ? 'v1' : null,
    });
  }
  return id;
}

/** The legal walk from the created state to `state`; empty for a state an intake is created in. */
function pathTo(state: IntakeState): [IntakeState, IntakeState][] {
  const walks: Partial<Record<IntakeState, IntakeState[]>> = {
    submitted: ['draft', 'submitted'],
    auto_cleared: ['draft', 'submitted', 'auto_cleared'],
    auto_flagged: ['draft', 'submitted', 'auto_flagged'],
    auto_rejected: ['draft', 'submitted', 'auto_rejected'],
    in_review: ['draft', 'submitted', 'auto_cleared', 'in_review'],
    approved: ['draft', 'submitted', 'auto_cleared', 'in_review', 'approved'],
    rejected: ['draft', 'submitted', 'auto_cleared', 'in_review', 'rejected'],
  };
  const walk = walks[state] ?? [];
  return walk.slice(0, -1).map((from, index) => [from, walk[index + 1] as IntakeState]);
}

const stateOf = async (id: string): Promise<IntakeState> => {
  const [row] = await db.select({ state: intakes.state }).from(intakes).where(eq(intakes.id, id));
  if (row === undefined) throw new Error(`no intake ${id}`);
  return row.state;
};

const countRows = async (table: typeof auditEntries | typeof intakes): Promise<number> => {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
  return row?.n ?? 0;
};

const actorFor = (from: IntakeState, to: IntakeState): TransitionActor => {
  const edge = edgeFor(from, to);
  if (edge?.actorKind === 'reviewer') return vermeer;
  return from === 'submitted' ? ENGINE : FORM;
};

const pairs: [IntakeState, IntakeState][] = INTAKE_STATES.flatMap((from) =>
  INTAKE_STATES.map((to): [IntakeState, IntakeState] => [from, to]),
);

describe('the transition grid through transitionIntake', () => {
  it.each(pairs)('%s -> %s', async (from, to) => {
    const id = await arriveAt(from);
    const auditBefore = await countRows(auditEntries);
    const edge = edgeFor(from, to);
    const request = {
      intakeId: id,
      to,
      actor: actorFor(from, to),
      reason: 'the grid says so',
      rulesetVersion: edge?.requiresRulesetVersion === true ? 'v1' : null,
    };

    if (edge === undefined) {
      await expect(transitionIntake(db, request)).rejects.toBeInstanceOf(IllegalTransitionError);
      expect(await stateOf(id)).toBe(from);
      expect(await countRows(auditEntries)).toBe(auditBefore);
      return;
    }

    const result = await transitionIntake(db, request);
    expect(result).toMatchObject({ from, to });
    expect(await stateOf(id)).toBe(to);
    expect(await countRows(auditEntries)).toBe(auditBefore + 1);

    const [entry] = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.id, result.auditEntryId));
    expect(entry).toMatchObject({
      actor: request.actor.name,
      entityType: 'intake',
      entityId: id,
      fromState: from,
      toState: to,
      reason: 'the grid says so',
      rulesetVersion: edge.requiresRulesetVersion === true ? 'v1' : null,
    });
    expect(entry?.actorReviewerId).toBe(
      request.actor.kind === 'reviewer' ? request.actor.id : null,
    );
  });
});

describe('who the audit entry names', () => {
  it('gives a named process a dedupe key and a reviewer none (ADR-0012 item 1)', async () => {
    const id = await arriveAt('draft');
    const byProcess = await transitionIntake(db, {
      intakeId: id,
      to: 'submitted',
      actor: FORM,
      reason: 'submitted through the intake form',
    });
    await transitionIntake(db, {
      intakeId: id,
      to: 'auto_flagged',
      actor: ENGINE,
      reason: 'flagged: current GLP-1 medication (declared by patient)',
      rulesetVersion: 'v1',
    });
    const byReviewer = await transitionIntake(db, {
      intakeId: id,
      to: 'in_review',
      actor: bakker,
      reason: 'taking a look',
    });

    const keyOf = async (auditEntryId: string): Promise<string | null> => {
      const [row] = await db
        .select({ key: auditEntries.dedupeKey })
        .from(auditEntries)
        .where(eq(auditEntries.id, auditEntryId));
      return row?.key ?? null;
    };
    expect(await keyOf(byProcess.auditEntryId)).toBe(
      'intake|' + id + '|draft|submitted|submitted through the intake form',
    );
    expect(await keyOf(byReviewer.auditEntryId)).toBeNull();
  });

  it('orders the entries of one transaction by seq', async () => {
    const id = await arriveAt('draft');
    const first = await transitionIntake(db, {
      intakeId: id,
      to: 'submitted',
      actor: FORM,
      reason: 'submitted',
    });
    const second = await transitionIntake(db, {
      intakeId: id,
      to: 'auto_cleared',
      actor: ENGINE,
      reason: 'cleared: no rejecting or flagging rule matched',
      rulesetVersion: 'v1',
    });
    expect(second.seq).toBeGreaterThan(first.seq);
  });
});

describe('who may take a reviewer edge (ADR-0027)', () => {
  it.each([['approved' as const], ['rejected' as const]])(
    'lets any reviewer take in_review -> %s',
    async (to) => {
      for (const actor of [vermeer, bakker]) {
        const id = await arriveAt('in_review');
        await expect(
          transitionIntake(db, { intakeId: id, to, actor, reason: 'my decision' }),
        ).resolves.toMatchObject({ to });
      }
    },
  );

  it.each([['auto_cleared' as const], ['auto_flagged' as const], ['legacy_pending' as const]])(
    'lets any reviewer claim from %s',
    async (from) => {
      for (const actor of [vermeer, bakker]) {
        const id = await arriveAt(from);
        await expect(
          transitionIntake(db, { intakeId: id, to: 'in_review', actor, reason: 'claiming' }),
        ).resolves.toMatchObject({ to: 'in_review' });
      }
    },
  );
});

// Q1: the age rule is absolute because a reviewer cannot resolve it in the patient's favour.
describe('the age carve-out (ADR-0014 item 3)', () => {
  const underAge = {
    matched: ['age_below_minimum' as const],
    engineOutcome: 'auto_rejected' as const,
  };

  it('refuses to approve an intake the rules rejected on age, and writes nothing', async () => {
    const id = await arriveAt('in_review', { evaluate: false });
    await db
      .insert(eligibilityEvaluations)
      .values(eligibilityEvaluationRow(id, { shadow: false, ...underAge }));
    const before = await countRows(auditEntries);

    await expect(
      transitionIntake(db, { intakeId: id, to: 'approved', actor: vermeer, reason: 'looks fine' }),
    ).rejects.toThrow(/age_below_minimum/);
    expect(await stateOf(id)).toBe('in_review');
    expect(await countRows(auditEntries)).toBe(before);
  });

  it('still lets the same intake be rejected', async () => {
    const id = await arriveAt('in_review', { evaluate: false });
    await db
      .insert(eligibilityEvaluations)
      .values(eligibilityEvaluationRow(id, { shadow: false, ...underAge }));
    await expect(
      transitionIntake(db, { intakeId: id, to: 'rejected', actor: vermeer, reason: 'under 18' }),
    ).resolves.toMatchObject({ to: 'rejected' });
  });

  it('refuses approval when the intake has no stored evaluation at all', async () => {
    const id = await arriveAt('in_review', { evaluate: false });
    await expect(
      transitionIntake(db, { intakeId: id, to: 'approved', actor: vermeer, reason: 'looks fine' }),
    ).rejects.toThrow(/no stored evaluation/);
  });

  it('prefers the submission’s own evaluation to an older shadow one', async () => {
    const id = await arriveAt('in_review', { evaluate: false });
    await db.insert(eligibilityEvaluations).values(
      eligibilityEvaluationRow(id, {
        shadow: true,
        ...underAge,
        evaluatedAt: new Date('2020-01-01T00:00:00Z'),
      }),
    );
    await db.insert(eligibilityEvaluations).values(
      eligibilityEvaluationRow(id, {
        shadow: false,
        evaluatedAt: new Date('2026-01-01T00:00:00Z'),
      }),
    );
    await expect(
      transitionIntake(db, { intakeId: id, to: 'approved', actor: vermeer, reason: 'cleared' }),
    ).resolves.toMatchObject({ to: 'approved' });
  });
});

describe('a claim is exclusive because in_review -> in_review is not an edge', () => {
  it('lets the first reviewer in and refuses the second', async () => {
    const id = await arriveAt('auto_flagged');
    await transitionIntake(db, { intakeId: id, to: 'in_review', actor: bakker, reason: 'mine' });
    await expect(
      transitionIntake(db, { intakeId: id, to: 'in_review', actor: vermeer, reason: 'mine too' }),
    ).rejects.toBeInstanceOf(IllegalTransitionError);
  });
});
