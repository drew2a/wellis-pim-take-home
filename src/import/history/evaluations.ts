// Writes the shadow rows of the history audit into `eligibility_evaluations`, the same table Part
// B writes (ADR-0004). Nothing is applied to the intake: its legacy state stands, and the console
// shows the shadow verdict next to the legacy outcome.
//
// A shadow row is derived from (intake, ruleset), so it is upserted on that key rather than
// inserted: a later run under the same ruleset version after an engine fix converges instead of
// leaving two verdicts for one intake (ADR-0011 item 2). Part B's rows are never touched.
import { sql } from 'drizzle-orm';

import type { Queryable } from '@/db/queryable';
import { eligibilityEvaluations } from '@/db/schema';
import type { EligibilityOutcome } from '@/eligibility/types';

import type { ShadowEvaluation } from './audit';

export interface ShadowLoadResult {
  /** Rows written this run; the upsert touches every row, so this is the evaluation count. */
  readonly written: number;
  readonly outcomes: Readonly<Record<EligibilityOutcome, number>>;
}

const CHUNK = 500;

export async function writeShadowEvaluations(
  db: Queryable,
  runId: number,
  evaluations: readonly ShadowEvaluation[],
  intakeIds: ReadonlyMap<string, string>,
): Promise<ShadowLoadResult> {
  const rows = evaluations.map((evaluation) => {
    const intakeId = intakeIds.get(evaluation.intakeId);
    if (intakeId === undefined) {
      throw new Error(`shadow evaluation of ${evaluation.intakeId} has no canonical intake`);
    }
    return {
      intakeId,
      rulesetVersion: evaluation.result.rulesetVersion,
      engineOutcome: evaluation.result.outcome,
      reasons: [...evaluation.result.reasons],
      matched: [...evaluation.result.matched],
      inputs: evaluation.result.inputs,
      shadow: true,
      importRunId: runId,
    };
  });

  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const returned = await db
      .insert(eligibilityEvaluations)
      .values(rows.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: [eligibilityEvaluations.intakeId, eligibilityEvaluations.rulesetVersion],
        targetWhere: sql`${eligibilityEvaluations.shadow}`,
        set: {
          engineOutcome: sql`excluded.engine_outcome`,
          reasons: sql`excluded.reasons`,
          matched: sql`excluded.matched`,
          inputs: sql`excluded.inputs`,
          evaluatedAt: sql`now()`,
          importRunId: sql`excluded.import_run_id`,
        },
      })
      .returning({ id: eligibilityEvaluations.id });
    written += returned.length;
  }

  const outcomes: Record<EligibilityOutcome, number> = {
    auto_rejected: 0,
    auto_flagged: 0,
    auto_cleared: 0,
    not_evaluable: 0,
  };
  for (const evaluation of evaluations) outcomes[evaluation.result.outcome] += 1;
  return { written, outcomes };
}
