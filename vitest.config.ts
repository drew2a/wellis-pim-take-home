import { defineConfig } from 'vitest/config';

export default defineConfig({
  // `@/*` comes from tsconfig.json `paths`; Vite reads it instead of a second alias table here.
  resolve: { tsconfigPaths: true },
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/*.integration.test.ts', 'node_modules/**'],
  },
});
