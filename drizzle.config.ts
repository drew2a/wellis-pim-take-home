import { defineConfig } from 'drizzle-kit';

import { loadEnv } from './src/env';

const env = loadEnv();

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  // Migrations need a session-mode connection; production offers one on a different port than
  // the app's transaction pooler, hence MIGRATION_URL (see src/env.ts).
  dbCredentials: { url: env.MIGRATION_URL ?? env.DATABASE_URL },
});
