import { existsSync } from 'node:fs';

import { defineConfig } from 'vitest/config';

import { resolve } from './vitest.config';

// Next.js reads .env itself; Vitest does not. CI sets DATABASE_URL directly and has no .env.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  resolve,
  test: {
    include: ['src/**/*.integration.test.ts'],
    // One connection at a time: the tests share the compose database.
    fileParallelism: false,
  },
});
