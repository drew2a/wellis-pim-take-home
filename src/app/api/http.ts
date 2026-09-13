// Shared response shapes for every route under `src/app/api/` — the patient's intake routes and
// the review console's alike. Every input from outside the process goes through Zod at its point
// of entry (ADR-0003); these helpers only decide what the caller is told.
import { z } from 'zod';

export interface ApiIssue {
  readonly path: string;
  readonly message: string;
}

export const issuesOf = (error: z.ZodError): ApiIssue[] =>
  error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));

/**
 * Every route here answers with one patient's own intake — their name, email, date of birth,
 * weight and medication — and the intake's uuid is the only thing that authorises the read, since
 * there is no patient authentication (README, R-S4). A store that kept such a response would serve
 * it to the next caller of that URL, so none of them is stored: not by the browser, not by a proxy,
 * not by a CDN in front of the deployment.
 *
 * It is set on the failures too. A 404 and a 409 say whether an intake exists and what state it is
 * in, which is the same answer, shorter.
 */
export const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export const badRequest = (message: string, issues: readonly ApiIssue[] = []): Response =>
  json({ error: message, issues }, 400);

export const notFound = (message: string): Response => json({ error: message }, 404);

export const conflict = (message: string): Response => json({ error: message }, 409);

/**
 * No session, or one that names nobody (ADR-0021 item 3). Every mutating console route answers
 * this before it reads its body, so an unauthenticated caller learns nothing about what the route
 * would have accepted.
 */
export const unauthorized = (): Response => json({ error: 'sign in to the console first' }, 401);

/**
 * A session, but not the role the action needs — today only `doctor`, on approve and reject
 * (ADR-0014 item 3). The machine's own message is passed through, because "this transition does
 * not exist for you" is what the reviewer has to be told.
 */
export const forbidden = (message: string): Response => json({ error: message }, 403);

/** How far `describeError` follows `cause`. Bounded so a cyclic chain cannot spin. */
const MAX_CAUSE_DEPTH = 4;

const WITHHELD = 'failed query (statement and parameters withheld)';

/** Postgres sends a SQLSTATE in `code`; a `TypeError` has none. */
function codeOf(error: Error): string {
  const { code } = error as { code?: unknown };
  return typeof code === 'string' ? ` [${code}]` : '';
}

/**
 * Drizzle wraps every failed statement in a `DrizzleQueryError`, which holds the statement and its
 * bound parameters in `.query` and `.params` — and repeats them in its own message, which reads
 * `Failed query: <sql>\nparams: <values>`. Those values are the patient's name, email and date of
 * birth, so its message is withheld and the wrapper's `cause` — the driver's own error, with the
 * SQLSTATE that says what actually went wrong — is what the log line carries.
 *
 * Recognised by shape rather than `instanceof`, so the log does not depend on which drizzle entry
 * point threw and cannot start leaking if the class moves.
 */
function isQueryError(error: Error): boolean {
  const { query, params } = error as { query?: unknown; params?: unknown };
  return typeof query === 'string' && Array.isArray(params);
}

/**
 * A failure in the three fields that say what broke without saying what the patient typed: name,
 * code, message. Never the error object — `console.error` expands an object's own properties, and
 * on a `DrizzleQueryError` those are the bound parameters.
 */
export function describeError(error: unknown, depth = 0): string {
  if (!(error instanceof Error)) return `non-error ${typeof error}`;
  const head = `${error.name}${codeOf(error)}: ${isQueryError(error) ? WITHHELD : error.message}`;
  if (error.cause === undefined || depth >= MAX_CAUSE_DEPTH) return head;
  return `${head} <- ${describeError(error.cause, depth + 1)}`;
}

/**
 * The reason stays in the server log; the response never carries it. A stack trace or a Postgres
 * message on a patient-facing route tells an attacker about the schema and tells the patient
 * nothing they can act on.
 *
 * The log gets a string, not the error: a server log is read by more people and kept longer than
 * the row it describes, and patient data does not belong in it.
 */
export function serverError(context: string, error: unknown): Response {
  console.error(context, describeError(error));
  return json({ error: 'something went wrong on our side' }, 500);
}

/** Route params are input like any other (ADR-0003): an id that is not a uuid never reaches SQL. */
export const routeUuid = z.uuid();
