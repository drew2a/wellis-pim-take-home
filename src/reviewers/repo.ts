// Reading the care team. The `reviewers` table is this module's (`./seed.ts` writes it), and every
// reader goes through here so no page and no route holds a query of its own (ADR-0024).
import { eq } from 'drizzle-orm';

import type { Queryable } from '@/db/queryable';
import { reviewers } from '@/db/schema';

export interface ReviewerRecord {
  readonly id: string;
  readonly name: string;
}

const COLUMNS = { id: reviewers.id, name: reviewers.name };

/** The team, by name, for the login page's list and nothing else. */
export async function listReviewers(db: Queryable): Promise<ReviewerRecord[]> {
  return db.select(COLUMNS).from(reviewers).orderBy(reviewers.name);
}

/** One reviewer, or null when the seed has removed them: the row is the identity (ADR-0021). */
export async function findReviewer(db: Queryable, id: string): Promise<ReviewerRecord | null> {
  const [row] = await db.select(COLUMNS).from(reviewers).where(eq(reviewers.id, id));
  return row ?? null;
}
