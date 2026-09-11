import { defineConfig } from 'drizzle-kit';

import { loadEnv } from './src/env';

// `drizzle-kit generate` and `check` read only the schema and need no database; `migrate` does.
// Without this presence test, generating a migration on a machine without DATABASE_URL failed
// on env validation for a URL that would never be used. When a URL is present it still goes
// through loadEnv(), the one place the environment is validated (ADR-0003).
const connection =
  process.env.DATABASE_URL === undefined && process.env.MIGRATION_URL === undefined
    ? {}
    : { dbCredentials: { url: migrationUrl() } };

function migrationUrl(): string {
  const env = loadEnv();
  // Migrations need a session-mode connection; production offers one on a different port than
  // the app's transaction pooler, hence MIGRATION_URL (ADR-0008 item 5, src/env.ts).
  return env.MIGRATION_URL ?? env.DATABASE_URL;
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  ...connection,
});
