// `npm run seed:reviewers`: applies the REVIEWERS environment variable to the database
// (ADR-0014 item 4). Idempotent — it upserts by name, so a deploy runs it every time.
import { getDb } from '@/db/client';
import { loadEnv } from '@/env';

import { seedReviewers } from './seed';

async function main(): Promise<void> {
  const seeds = loadEnv().REVIEWERS ?? [];
  if (seeds.length === 0) {
    throw new Error('REVIEWERS is not set; see .env.example for the shape');
  }
  const result = await seedReviewers(getDb(), seeds);
  process.stdout.write(`seeded ${result.seeded} reviewers: ${result.names.join(', ')}\n`);
}

await main();
process.exit(0);
