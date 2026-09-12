// The importer's own merges: tier 1 only, the one case `CLAUDE.md` §5 lets a machine decide,
// because the records are literally identical on identity and non-contradictory on everything
// else (ADR-0006). Every merge goes through the same repository function a reviewer's decision
// does, so both leave the same audit trail and both can be taken back.
import type { Queryable } from '@/db/queryable';
import { MERGED_INTO, mergePatients } from '@/repo/merge';

import { IMPORTER_ACTOR } from '../actors';
import type { HumanOwned } from '../canonical/human-owned';
import { survivorOfGroup, type CandidateGroup } from './candidates';

export interface Tier1MergeResult {
  /** Pairs merged by this run; zero on a re-run, which finds the alias already repointed. */
  readonly merged: number;
  /** Pairs already merged when the run started: the idempotency of ADR-0006 in one number. */
  readonly alreadyMerged: number;
  /** Fields a survivor took from its loser, with provenance (ADR-0011 item 9: zero here). */
  readonly gainedFields: number;
  /** Pairs left alone because a human already decided their `merged_into` (ADR-0012 item 2). */
  readonly humanDecided: number;
}

export async function mergeTier1Groups(
  db: Queryable,
  groups: readonly CandidateGroup[],
  patientIds: ReadonlyMap<string, string>,
  declaredConsentTypes: readonly string[],
  humanOwned: HumanOwned,
): Promise<Tier1MergeResult> {
  let merged = 0;
  let alreadyMerged = 0;
  let gainedFields = 0;
  let humanDecided = 0;
  for (const group of groups.filter((candidate) => candidate.tier === 1)) {
    const { survivor, losers, rule } = survivorOfGroup(group.members);
    const survivorId = patientIds.get(survivor.legacyId);
    if (survivorId === undefined) {
      throw new Error(`tier-1 survivor ${survivor.legacyId} has no canonical patient`);
    }
    for (const loser of losers) {
      const loserId = patientIds.get(loser.legacyId);
      if (loserId === undefined) {
        throw new Error(`tier-1 loser ${loser.legacyId} has no canonical patient`);
      }
      // A re-run resolves both legacy ids through the repointed alias table, so they arrive here
      // as one patient: that is what "the alias is already repointed" looks like (ADR-0006).
      if (loserId === survivorId) {
        alreadyMerged += 1;
        continue;
      }
      // A reviewer who unmerged this pair — or merged the loser into someone else — wrote
      // `merged_into` with a human actor, which is what makes a field human-owned (R-A17,
      // ADR-0009 item 4). Merging it back would undo their decision, and asking again would be
      // residue rather than a decision (`CLAUDE.md` §5), so the pair is left alone and counted
      // (ADR-0012 item 2).
      if (humanOwned.get(loserId)?.has(MERGED_INTO) === true) {
        humanDecided += 1;
        continue;
      }
      const outcome = await mergePatients(db, {
        survivorId,
        loserId,
        actor: IMPORTER_ACTOR,
        reason: `tier-1 merge, ${rule}`,
        declaredConsentTypes,
      });
      if (outcome.merged) merged += 1;
      else alreadyMerged += 1;
      gainedFields += outcome.gained.length;
    }
  }
  return { merged, alreadyMerged, gainedFields, humanDecided };
}
