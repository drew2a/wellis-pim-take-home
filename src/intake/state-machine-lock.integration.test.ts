// The second lock (ADR-0014 item 6): the database refuses an illegal state even when the
// application is not involved at all. Every statement here is raw SQL on purpose — the point is
// what a client with a connection string can do, not what `transitionIntake` allows.
//
// The grid is driven from the TypeScript edge table, so if the trigger's copy of it ever diverges
// this test fails rather than the divergence reaching production.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, expectDatabaseError, type TestDatabase } from '@/test/database';

import { edgeFor, INITIAL_STATES, INTAKE_STATES, isLegacyState, type IntakeState } from './machine';

let database: TestDatabase;
let sql: TestDatabase['sql'];

beforeAll(async () => {
  database = await createTestDatabase();
  sql = database.sql;
  await database.migrate();
}, 60_000);

afterAll(async () => {
  await database.drop();
});

beforeEach(async () => {
  await database.truncateAll();
});

let keys = 0;

/** Inserts an intake directly in `state`, which the trigger allows only for an initial state. */
async function insertIn(state: IntakeState): Promise<string> {
  keys += 1;
  const rows = await sql<{ id: string }[]>`
    insert into intakes (intake_id, medication_report, condition_report, outcome, state)
    values (${`INT-${keys}`}, 'not_answered', 'not_answered', 'unknown', ${state}::intake_state)
    returning id`;
  const row = rows[0];
  if (row === undefined) throw new Error(`inserting an intake in ${state} returned no row`);
  return row.id;
}

/**
 * Gets an intake into `state` for the UPDATE tests, bypassing the machine the only way the
 * fixture may: with the trigger switched off for the length of one transaction. No code under
 * `src/` does this — it is how the test reaches states an INSERT is not allowed to create.
 */
async function forceInto(id: string, state: IntakeState): Promise<void> {
  await sql.begin(async (tx) => {
    await tx.unsafe('set local session_replication_role = replica');
    await tx`update intakes set state = ${state}::intake_state where id = ${id}`;
  });
}

const stateOf = async (id: string): Promise<string> => {
  const rows = await sql<{ state: string }[]>`select state from intakes where id = ${id}`;
  return rows[0]?.state ?? 'gone';
};

const pairs: [IntakeState, IntakeState][] = INTAKE_STATES.flatMap((from) =>
  INTAKE_STATES.map((to): [IntakeState, IntakeState] => [from, to]),
);

/** What the trigger of ADR-0014 item 6 does with a pair, independently of who is acting. */
function triggerAllows(from: IntakeState, to: IntakeState): boolean {
  if (from === to) return true; // not a state change at all
  if (edgeFor(from, to) !== undefined) return true;
  // A re-import may re-map an outcome spelling it could not read before (ADR-0009 item 8).
  return isLegacyState(from) && isLegacyState(to);
}

describe('the intakes state-machine trigger', () => {
  it('divides the 144 pairs into 10 edges, 12 no-ops, 12 legacy re-mappings and 110 refusals', () => {
    const counts = { edges: 0, noop: 0, legacy: 0, refused: 0 };
    for (const [from, to] of pairs) {
      if (from === to) counts.noop += 1;
      else if (edgeFor(from, to) !== undefined) counts.edges += 1;
      else if (isLegacyState(from) && isLegacyState(to)) counts.legacy += 1;
      else counts.refused += 1;
    }
    expect(counts).toEqual({ edges: 10, noop: 12, legacy: 12, refused: 110 });
  });

  it.each(pairs)('a direct UPDATE %s -> %s', async (from, to) => {
    const id = await insertIn('draft');
    if (from !== 'draft') await forceInto(id, from);

    const update = sql`update intakes set state = ${to}::intake_state where id = ${id}`;
    if (triggerAllows(from, to)) {
      await update;
      expect(await stateOf(id)).toBe(to);
    } else {
      await expectDatabaseError(update, /is not a legal intake transition/);
      expect(await stateOf(id)).toBe(from);
    }
  });
});

describe('what state an intake may be created in', () => {
  it.each(INTAKE_STATES.map((state) => [state]))('inserting in %s', async (state) => {
    if (INITIAL_STATES.includes(state)) {
      await expect(insertIn(state)).resolves.toBeTypeOf('string');
    } else {
      await expectDatabaseError(insertIn(state), /cannot be created in state/);
    }
  });

  it('allows exactly draft and the four legacy states', () => {
    expect(INITIAL_STATES).toEqual([
      'draft',
      'legacy_approved',
      'legacy_rejected',
      'legacy_pending',
      'legacy_expired',
    ]);
  });
});

// What the patient submitted is the new flow's raw record (ADR-0015 item 1).
describe('the answers of a submitted intake', () => {
  const answers = { formVersion: 'intake-form-v1' };

  it('can still be edited while the intake is a draft', async () => {
    const id = await insertIn('draft');
    await sql`update intakes set answers = ${JSON.stringify(answers)}::jsonb where id = ${id}`;
    const rows = await sql<{ answers: unknown }[]>`select answers from intakes where id = ${id}`;
    expect(rows[0]?.answers).toEqual(answers);
  });

  it('is refused once the intake has left draft', async () => {
    const id = await insertIn('draft');
    await sql`update intakes set answers = ${JSON.stringify(answers)}::jsonb where id = ${id}`;
    await forceInto(id, 'submitted');
    await expectDatabaseError(
      sql`update intakes set answers = ${JSON.stringify({ formVersion: 'tampered' })}::jsonb where id = ${id}`,
      /answers of intake .* are evidence/,
    );
  });

  it('does not stand in the way of the intake’s other columns changing', async () => {
    const id = await insertIn('draft');
    await forceInto(id, 'auto_flagged');
    await sql`update intakes set reviewer_note = 'a note' where id = ${id}`;
    expect(await stateOf(id)).toBe('auto_flagged');
  });
});
