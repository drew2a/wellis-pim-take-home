import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'drizzle/**', 'reports/**'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  nextVitals,
  nextTs,
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
      // `unknown` plus narrowing is the only sanctioned way in (CLAUDE.md §2).
      '@typescript-eslint/no-explicit-any': 'error',
      // Numbers render unambiguously; forbidding `${count}` in report code buys nothing.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // Conflicts with strict's no-non-null-assertion, which we keep: `as T` over `x!`.
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',
    },
  },
  {
    // Config files export objects for their tools, not a module API.
    files: ['*.config.ts'],
    rules: { '@typescript-eslint/explicit-module-boundary-types': 'off' },
  },
  prettier,
);
