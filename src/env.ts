import { z } from 'zod';

// Validated once, at the process boundary (CLAUDE.md §2, ADR-0003). Everything downstream
// trusts the resulting type and never re-checks the raw environment.
const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });

// `KEY=` in a .env file and a CI variable bound to an unset secret both arrive as '', which
// means "not set" for an optional variable; `.optional()` alone would reject the empty string.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const envSchema = z.object({
  DATABASE_URL: postgresUrl,
  // Same role and secret as DATABASE_URL through the Supabase session pooler (port 5432) instead
  // of the transaction pooler (6543), which cannot run migrations. Read by drizzle-kit only
  // (ADR-0008). Locally and in CI one URL serves both, so db:migrate falls back to DATABASE_URL.
  MIGRATION_URL: optional(postgresUrl),
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
