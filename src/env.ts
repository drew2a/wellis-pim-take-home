import { z } from 'zod';

import { SYSTEM_ACTORS } from '@/import/actors';

// Validated once, at the process boundary (CLAUDE.md §2, ADR-0003). Everything downstream
// trusts the resulting type and never re-checks the raw environment.
const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });

// `KEY=` in a .env file and a CI variable bound to an unset secret both arrive as '', which
// means "not set" for an optional variable; `.optional()` alone would reject the empty string.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

// The care team, seeded by `npm run seed:reviewers` (ADR-0014 item 4). A JSON array so one
// variable carries both fields; identification for the audit, never authentication (Q8, R-S4).
const reviewerSeedSchema = z.object({
  // A reviewer may not be named after a named process. `dedupeKeyFor` branches on SYSTEM_ACTORS to
  // decide whether an audit entry gets a deterministic idempotency key (ADR-0008 item 1), so a
  // reviewer called "importer" would have their decisions keyed like a machine's: repeating an
  // identical decision would hit the unique constraint instead of recording a second event, and
  // the importer would treat their edits as machine-owned and overwrite them (ADR-0004, R-A17).
  name: z
    .string()
    .trim()
    .min(1)
    .refine((name) => !SYSTEM_ACTORS.has(name), {
      message: 'is the name of a named process and cannot also be a reviewer',
    }),
  role: z.enum(['doctor', 'ops']),
});

export type ReviewerSeed = z.infer<typeof reviewerSeedSchema>;

// A malformed value must fail as a validation message, not as a raw SyntaxError from the parser,
// so unparseable JSON is handed on as the string it was and the array schema rejects it.
const jsonArray = z.preprocess((value): unknown => {
  if (typeof value !== 'string' || value === '') return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}, z.array(reviewerSeedSchema).optional());

const envSchema = z.object({
  DATABASE_URL: postgresUrl,
  // Same role and secret as DATABASE_URL through the Supabase session pooler (port 5432) instead
  // of the transaction pooler (6543), which cannot run migrations. Read by drizzle-kit only
  // (ADR-0008). Locally and in CI one URL serves both, so db:migrate falls back to DATABASE_URL.
  MIGRATION_URL: optional(postgresUrl),
  // The integration tests create and FORCE-drop databases on the DATABASE_URL host. They refuse
  // a non-local host unless this is set, so a .env pointed at production for a migration cannot
  // be hit by `npm run check`.
  ALLOW_REMOTE_TEST_DATABASE: optional(z.literal('1')),
  // e.g. REVIEWERS='[{"name":"Dr Vermeer","role":"doctor"},{"name":"Sanne","role":"ops"}]'
  REVIEWERS: jsonArray,
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

let cached: Env | undefined;

/** Reads and validates `process.env` on first use; throws before any database work. */
export function loadEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
