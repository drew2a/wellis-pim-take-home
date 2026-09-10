import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    globalSetup: ['test/integration-setup.ts'],
    // One connection at a time: the tests share the compose database.
    fileParallelism: false,
  },
});
