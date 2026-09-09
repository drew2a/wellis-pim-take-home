/**
 * Entry-point plumbing shared by the three profile scripts: where the repo is, where the
 * generated documents go, and the arguments every script takes.
 *
 * Why one module: three scripts each resolved the repo root and spelled the output paths
 * themselves, and one of them (`profile.ts`) used `URL.pathname`, which breaks on a checkout
 * path containing a space or a non-ASCII character. `fileURLToPath` is the correct decoding.
 */
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const EXPORT_DIR = join(ROOT, 'legacy_export');

/** Repo-relative paths, as the generated documents name them for the reader. */
export const PROFILE_MD = 'docs/profile/data-profile.md';
export const PROFILE_JSON = 'docs/profile/data-profile.json';
export const HYPOTHESES_MD = 'docs/profile/data-hypotheses.md';
export const INVENTORY_HTML = 'docs/profile/legacy-export-inventory.html';

export function abs(repoRelative: string): string {
  return join(ROOT, ...repoRelative.split('/'));
}
