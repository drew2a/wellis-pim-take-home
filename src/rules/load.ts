import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { rulesSchema, type Rules } from './schema';

// Resolved from the working directory: every entry point (`npm run import`, vitest, the API)
// runs from the repository root, and `process.cwd()` survives bundling where import.meta does not.
export const RULES_V1_PATH = join(process.cwd(), 'rules', 'v1.json');

/** Validates an already-parsed JSON value. Exported so tests can mutate a copy and expect failure. */
export function parseRules(source: unknown): Rules {
  const result = rulesSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`rules file is invalid:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/** Reads and validates the rules file once, at the boundary (CLAUDE.md §2). */
export function loadRules(path: string = RULES_V1_PATH): Rules {
  return parseRules(JSON.parse(readFileSync(path, 'utf8')));
}

let cached: Rules | undefined;

/**
 * The ruleset in force, read once per process. The file is immutable in a running deployment — a
 * new ruleset is a new version and a new file — so re-reading it per request would buy nothing.
 */
export function currentRules(): Rules {
  cached ??= loadRules();
  return cached;
}
