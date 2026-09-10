import { defineConfig } from 'drizzle-kit';

import { loadEnv } from './src/env';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: loadEnv().DATABASE_URL },
});
