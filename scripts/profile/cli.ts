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

/**
 * The reference date every "future" count is measured against, as `YYYY-MM-DD`.
 *
 * Why an argument: the profile used to infer it from the latest date in the export, which
 * made the threshold a value nobody chose (and, through the ambiguous date reader, a date
 * that occurred nowhere in the files). The wall clock would make two runs disagree. So the
 * date is explicit, mandatory, and printed in every generated document's header.
 */
export function asOfFromArgv(argv: readonly string[] = process.argv.slice(2)): string {
  let value: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === '--as-of') value = argv[i + 1];
    else if (a.startsWith('--as-of=')) value = a.slice('--as-of='.length);
  }
  if (value === undefined || !/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error('usage: --as-of YYYY-MM-DD (the reference date for every "future" count; required)');
  }
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const back = new Date(Date.UTC(y, m - 1, d));
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
    throw new Error(`--as-of ${value} is not a calendar date`);
  }
  return value;
}

/** The exact command that reproduces a document, for its header. */
export function reproduceCommand(npmScript: string, asOf: string): string {
  return `npm run ${npmScript} -- --as-of ${asOf}`;
}
