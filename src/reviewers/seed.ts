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
  const written = await db
    .insert(reviewers)
    .values(seeds.map((seed) => ({ name: seed.name, role: seed.role })))
    // A role can change; a name identifies. `excluded` so each row takes its own seed's role —
    // a literal here would give every existing reviewer the role of whichever seed came first.
    .onConflictDoUpdate({ target: reviewers.name, set: { role: sql`excluded.role` } })
    .returning({ name: reviewers.name });
  return { seeded: written.length, names: written.map((row) => row.name) };
}
