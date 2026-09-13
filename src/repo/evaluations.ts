// The evaluation that governs an intake: the latest one, non-shadow first on a tie (ADR-0014
// item 3). For a new intake that is the submission's own evaluation; for a legacy one it is the
// current ruleset's shadow evaluation.
//
// One definition, because two readers depend on it and must agree: the transition function, which
// refuses to approve an intake the rules rejected absolutely, and the console, which shows a
// reviewer the reasons that refusal quotes.
import { desc, eq } from 'drizzle-orm';

import type { Queryable } from '@/db/queryable';
import { eligibilityEvaluations } from '@/db/schema';

export type Evaluation = typeof eligibilityEvaluations.$inferSelect;

export async function governingEvaluation(
  db: Queryable,
  intakeId: string,
): Promise<Evaluation | null> {
  const [row] = await db
    .select()
    .from(eligibilityEvaluations)
    .where(eq(eligibilityEvaluations.intakeId, intakeId))
    .orderBy(desc(eligibilityEvaluations.evaluatedAt), eligibilityEvaluations.shadow)
    .limit(1);
  return row ?? null;
}
