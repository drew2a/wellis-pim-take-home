// The care team, seeded from the environment (ADR-0014 item 4). Upserted by name, because the name
// is what the audit entry records and what the seed can be re-applied against; a deploy that adds
// a reviewer or changes a role re-runs this and changes nothing else.
//
// This is identification, not authentication: there is no login, no session and no password, which
// is a deliberate scope cut (Q8 default A, R-S4, `README.md`).
import { sql } from 'drizzle-orm';

import { reviewers } from '@/db/schema';

import type { Queryable } from '@/db/queryable';
import type { ReviewerSeed } from '@/env';

export interface SeedResult {
  readonly seeded: number;
  readonly names: readonly string[];
}

export async function seedReviewers(
  db: Queryable,
  seeds: readonly ReviewerSeed[],
): Promise<SeedResult> {
  if (seeds.length === 0) return { seeded: 0, names: [] };
  const duplicates = seeds.map((seed) => seed.name).filter((name, i, all) => all.indexOf(name) < i);
  if (duplicates.length > 0) {
    throw new Error(`REVIEWERS names two reviewers the same: ${duplicates.join(', ')}`);
  }
  // A reviewer is a name (ADR-0027), so a name that is already there needs no update — but the
  // insert still has to report it as seeded, which `onConflictDoNothing` would not: it returns
  // nothing for the conflicting row, and `npm run seed:reviewers` would print a count that shrank
  // on every re-run. Writing the name back to itself keeps the row in `returning`.
  const written = await db
    .insert(reviewers)
    .values(seeds.map((seed) => ({ name: seed.name })))
    .onConflictDoUpdate({ target: reviewers.name, set: { name: sql`excluded.name` } })
    .returning({ name: reviewers.name });
  return { seeded: written.length, names: written.map((row) => row.name) };
}
