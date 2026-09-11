// `npm run import -- --as-of YYYY-MM-DD [--dry-run]`: loads legacy_export/ into the database
// named by DATABASE_URL and prints the counts (ADR-0003, the brief item 7). Arguments are
// validated here, once, at the process boundary; everything after trusts the types.
import { existsSync } from 'node:fs';

import { z } from 'zod';

import { getDb } from '@/db/client';
import { loadRules } from '@/rules/load';

import { formatSummary } from './report/counts';
import { runImport } from './run';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, 'YYYY-MM-DD')
  .refine((value) => {
    const [y, m, d] = value.split('-').map(Number) as [number, number, number];
    const back = new Date(Date.UTC(y, m - 1, d));
    return back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d;
  }, 'not a calendar date');

const argsSchema = z.object({ asOf: isoDate, dryRun: z.boolean() });

export type Args = z.infer<typeof argsSchema>;

export function parseArgs(argv: readonly string[]): Args {
  const raw: { asOf: string | undefined; dryRun: boolean } = { asOf: undefined, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === '--as-of') {
      raw.asOf = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--as-of=')) {
      raw.asOf = arg.slice('--as-of='.length);
    } else if (arg === '--dry-run') {
      raw.dryRun = true;
    } else {
      throw new Error(
        `unknown argument ${arg}\nusage: npm run import -- --as-of YYYY-MM-DD [--dry-run]`,
      );
    }
  }
  const result = argsSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `usage: npm run import -- --as-of YYYY-MM-DD [--dry-run]\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // Next.js reads .env itself; a plain tsx process does not. Existing variables win.
  if (existsSync('.env')) process.loadEnvFile('.env');
  const db = getDb();
  try {
    const summary = await runImport(db, {
      exportDir: 'legacy_export',
      asOf: args.asOf,
      dryRun: args.dryRun,
      rules: loadRules(),
    });
    console.log(formatSummary(summary));
  } finally {
    await db.$client.end();
  }
}

// Only when run as a script: the test imports parseArgs without starting an import.
if (process.argv[1]?.endsWith('cli.ts') === true) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
