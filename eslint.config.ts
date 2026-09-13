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
  {
    // Styling is reviewable only if it lives in one place: utility classes belong to the
    // components in `src/ui/`, and every other file composes those (see `src/ui/index.ts`,
    // ADR-0018). `style` is listed next to `className` because an inline style object is an
    // equally effective way out of the rule, and a rule with a door in it is not enforced.
    files: ['src/**/*.tsx'],
    ignores: ['src/ui/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXAttribute[name.name="className"]',
          message:
            'Utility classes live only in src/ui/. Compose a component from src/ui instead of styling here.',
        },
        {
          selector: 'JSXAttribute[name.name="style"]',
          message:
            'Styling lives only in src/ui/. Compose a component from src/ui instead of an inline style here.',
        },
      ],
    },
  },
  prettier,
);
