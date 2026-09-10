import { z } from 'zod';

// Validated once, at the process boundary (CLAUDE.md §2, ADR-0003). Everything downstream
// trusts the resulting type and never re-checks the raw environment.
const envSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
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
