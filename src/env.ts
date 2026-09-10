import { z } from 'zod';

// Validated once, at the process boundary (CLAUDE.md §2, ADR-0003). Everything downstream
// trusts the resulting type and never re-checks the raw environment.
const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });

const envSchema = z.object({
  DATABASE_URL: postgresUrl,
  // Production migrations and the importer go through the Supabase session pooler (port 5432);
  // the app through the transaction pooler (6543), which cannot run migrations. Locally and in
  // CI one URL serves both, so this is optional and db:migrate falls back to DATABASE_URL.
  MIGRATION_URL: postgresUrl.optional(),
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
