// `npm run seed:reviewers`: applies the REVIEWERS environment variable to the database
// (ADR-0014 item 4). Idempotent — it upserts by name, so a deploy runs it every time.
import { existsSync } from 'node:fs';

import { getDb } from '@/db/client';
import { loadEnv } from '@/env';

import { seedReviewers } from './seed';

async function main(): Promise<void> {
  // Next.js reads .env itself; a plain tsx process does not. Existing variables win, so a
  // deployment that sets REVIEWERS in its own environment is unaffected (as `npm run import` does).
  if (existsSync('.env')) process.loadEnvFile('.env');
  const seeds = loadEnv().REVIEWERS ?? [];
  if (seeds.length === 0) {
    throw new Error('REVIEWERS is not set; see .env.example for the shape');
  }
  const result = await seedReviewers(getDb(), seeds);
  process.stdout.write(`seeded ${result.seeded} reviewers: ${result.names.join(', ')}\n`);
}

await main();
process.exit(0);
