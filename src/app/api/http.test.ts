// What a failed route puts in the server log. A log is read by more people and kept longer than the
// row it describes, so the rule is that a patient's answers never reach it: drizzle wraps every
// failed statement in a `DrizzleQueryError` whose `.params` — and whose own message — are the
// values that were being written, which on these routes is the patient's name, email and date of
// birth.
import { DrizzleQueryError } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { describeError, serverError } from './http';

const PATIENT = {
  fullName: 'Sem de Boer',
  email: 'sem@example.com',
  dob: '1986-04-02',
};

/** What the driver throws underneath: a message that names the constraint, and a SQLSTATE. */
const driverError = (): Error =>
  Object.assign(
    new Error('duplicate key value violates unique constraint "patients_email_unique"'),
    { name: 'PostgresError', code: '23505' },
  );

/** What drizzle hands the route: the statement, its bound parameters, and the driver's error. */
const queryError = (): DrizzleQueryError =>
  new DrizzleQueryError(
    'insert into "patients" ("full_name", "email", "dob") values ($1, $2, $3)',
    [PATIENT.fullName, PATIENT.email, PATIENT.dob],
    driverError(),
  );

/** The arguments `serverError` hands `console.error`, kept as they were passed. */
function captureLog(): unknown[][] {
  const calls: unknown[][] = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    calls.push(args);
  });
  return calls;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('serverError', () => {
  it('logs none of a failed query’s bound parameters', async () => {
    const logged = captureLog();

    const response = serverError('submitting intake 0e0d failed', queryError());

    expect(logged).toHaveLength(1);
    const line = logged.flat().join(' ');
    for (const value of Object.values(PATIENT)) {
      expect(line).not.toContain(value);
    }
    // The statement goes too: it is where the parameters are about to land, and a schema dump on a
    // patient-facing failure tells an attacker more than it tells us.
    expect(line).not.toContain('insert into');
    expect(line).not.toContain('$1');

    // Withholding them is not the same as losing the failure: the SQLSTATE and the constraint are
    // what a reader needs, and they name no patient.
    expect(line).toContain('submitting intake 0e0d failed');
    expect(line).toContain('[23505]');
    expect(line).toContain('patients_email_unique');

    // The patient is told nothing about the schema (R-B9 owes them the engine's reasons, not ours).
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'something went wrong on our side' });
  });

  it('logs strings only, so nothing can be expanded into its properties', () => {
    const logged = captureLog();

    serverError('reading intake 0e0d failed', queryError());

    for (const argument of logged.flat()) {
      expect(typeof argument).toBe('string');
    }
  });
});

describe('describeError', () => {
  it('keeps the message of an error we raised ourselves', () => {
    expect(describeError(new Error('draft intake 0e0d has no answers'))).toBe(
      'Error: draft intake 0e0d has no answers',
    );
  });

  it('names the driver error under the wrapper', () => {
    expect(describeError(queryError())).toBe(
      'Error: failed query (statement and parameters withheld) <- ' +
        'PostgresError [23505]: duplicate key value violates unique constraint ' +
        '"patients_email_unique"',
    );
  });

  it('stops following cause at a bounded depth', () => {
    const cyclic = new Error('outer');
    cyclic.cause = cyclic;

    expect(describeError(cyclic).split(' <- ')).toHaveLength(5);
  });

  it('says what it got when something other than an error was thrown', () => {
    expect(describeError(PATIENT.email)).toBe('non-error string');
  });
});
