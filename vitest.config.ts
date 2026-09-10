import path from 'node:path';

import { defineConfig } from 'vitest/config';

// Mirrors `paths` in tsconfig.json; Vitest does not read it.
export const resolve = {
  alias: { '@': path.resolve(import.meta.dirname, 'src') },
};

export default defineConfig({
  resolve,
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/*.integration.test.ts', 'node_modules/**'],
  },
});
