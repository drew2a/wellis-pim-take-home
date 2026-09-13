import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import nextVitals from 'eslint-config-next/core-web-vitals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'drizzle/**', 'reports/**'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  nextVitals,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Module contracts stay visible at the boundary (Google TS style); inner arrows are inferred.
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      // Numbers render unambiguously; forbidding `${count}` in report code buys nothing.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // Conflicts with strict's no-non-null-assertion, which we keep: `as T` over `x!`.
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',
    },
  },
  {
    // `postcss.config.mjs` is JavaScript and outside the TypeScript project, so the rules that
    // need a type checker cannot run on it. Everything else still does.
    files: ['**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
);
