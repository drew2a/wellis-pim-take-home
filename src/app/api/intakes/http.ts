// Shared response shapes for the intake routes. Every input from outside the process goes through
// Zod at its point of entry (ADR-0003); these helpers only decide what the caller is told.
import { z } from 'zod';

export interface ApiIssue {
  readonly path: string;
  readonly message: string;
}

export const issuesOf = (error: z.ZodError): ApiIssue[] =>
  error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));

export const badRequest = (message: string, issues: readonly ApiIssue[] = []): Response =>
  Response.json({ error: message, issues }, { status: 400 });

export const notFound = (message: string): Response =>
  Response.json({ error: message }, { status: 404 });

export const conflict = (message: string): Response =>
  Response.json({ error: message }, { status: 409 });

/**
 * The reason stays in the server log; the response never carries it. A stack trace or a Postgres
 * message on a patient-facing route tells an attacker about the schema and tells the patient
 * nothing they can act on.
 */
export function serverError(context: string, error: unknown): Response {
  console.error(context, error);
  return Response.json({ error: 'something went wrong on our side' }, { status: 500 });
}

/** Route params are input like any other (ADR-0003): an id that is not a uuid never reaches SQL. */
export const intakeIdSchema = z.uuid();
