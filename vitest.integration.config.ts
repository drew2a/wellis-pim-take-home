import { existsSync } from 'node:fs';

import { defineConfig } from 'vitest/config';

// Next.js reads .env itself; Vitest does not. CI sets DATABASE_URL directly and has no .env.
// TODO(drew2a): next dev, drizzle-kit and this file each load env files with different rules
// (.env.local is honoured only by Next). Consolidate into one loader inside loadEnv() on the
// importer branch, where the import CLI arrives.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ['src/**/*.integration.test.ts'],
    // Files may run in parallel: each creates and migrates its own database through
    // src/test/database.ts (ADR-0003 isolation, database per file), so no two files share tables.
  },
});
