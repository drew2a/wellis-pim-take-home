import { existsSync } from 'node:fs';

import { defineConfig } from 'vitest/config';

// Next.js reads .env itself; Vitest does not. CI sets DATABASE_URL directly and has no .env.
// TODO(drew2a): next dev, drizzle-kit and this file each load env files with different rules
// (.env.local is honoured only by Next). Consolidate into one loader inside loadEnv() on the
// importer branch, where the import CLI and a second connection URL arrive.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ['src/**/*.integration.test.ts'],
    // No tables exist yet, so there is nothing to isolate between files. The isolation strategy
    // ADR-0003 calls for (a schema per file or a transaction per test) is chosen in the schema
    // branch, where tables appear; until then files run one at a time against the shared
    // compose database.
    fileParallelism: false,
  },
});
