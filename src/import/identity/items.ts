// Tier 2 and tier 3 of ADR-0006 as review items: two competing versions of the truth shown side
// by side, with no proposed resolution. A conflict is one item, not one per differing field
// (R-C4, R-C5): the reviewer picks the surviving row and, per field, the winning value.
import { maskIdentifier } from '@/repo/mask';

import { dedupeKey, type ReviewItemDraft } from '../review/items';
import type { CandidateGroup, IdentityRow } from './candidates';

/** What the console shows per row: the person fields, the row's provenance and its context. */
function sideBySide(
  row: IdentityRow,
  context: { intakeCount: number; consentStates: ReadonlyMap<string, string> },
): Record<string, unknown> {
  return {
    legacy_id: row.legacyId,
    full_name: row.fullName,
    dob: row.dob,
    email: row.email,
    sex: row.sex,
    // Masked like every other identifier in a jsonb payload (ADR-0009 item 9); the console
    // reveals it from `patients.bsn`, where column-level masking applies.
    bsn: row.bsn === null ? null : maskIdentifier(row.bsn),
    phone: row.phone,
    city: row.city,
    weight_kg: row.weightKg,
    height_cm: row.heightCm,
    status: row.status,
    signup_date: row.signupDate,
    source: row.source,
    intake_count: context.intakeCount,
    // One state per consent type, never a single one: the table holds a row per type
    // (ADR-0011 item 16), and `{}` where the patient has none (ADR-0012 item 3).
    consent_states: Object.fromEntries(context.consentStates),
  };
}

export interface GroupContext {
  /** legacy id -> the patient uuid it resolves to, for the item's patient reference. */
  readonly patientIds: ReadonlyMap<string, string>;
  /** legacy id -> consent type -> the derived state, as context for the decision. */
  readonly consentStates: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

const EMPTY_STATES: ReadonlyMap<string, string> = new Map();

const TITLES: Readonly<Record<2 | 3, string>> = {
  2: 'two patient records may be the same person',
  3: 'two patient records share a key but contradict each other',
};

/**
 * One item per tier-2 or tier-3 group. Tier 3 is marked a conflict in the payload: the rows share
 * a key and disagree on a fact that cannot be true twice, so "latest wins" is never offered.
 */
export function identityConflictItems(
  groups: readonly CandidateGroup[],
  context: GroupContext,
): ReviewItemDraft[] {
  return groups
    .filter((group) => group.tier !== 1)
    .map((group) => {
      const tier = group.tier as 2 | 3;
      const legacyIds = group.members.map((row) => row.legacyId);
      const matched = group.matchedKeys.map((key) => key.kind);
      return {
        type: 'identity_conflict' as const,
        scope: 'row' as const,
        title: TITLES[tier],
        reason:
          tier === 3
            ? `matched on ${matched.join(', ')}; contradicts on ${group.contradictions.join(', ')}`
            : `matched on ${matched.join(', ')}; differs on ${group.differences.join(', ')}`,
        payload: {
          tier,
          conflict: tier === 3,
          matched_keys: matched,
          contradictions: group.contradictions,
          differences: group.differences,
          rows: group.members.map((row) =>
            sideBySide(row, {
              intakeCount: row.intakeCount,
              consentStates: context.consentStates.get(row.legacyId) ?? EMPTY_STATES,
            }),
          ),
          actions: ['merge_with_chosen_values', 'not_the_same_person'],
          note: 'both actions need a note; no resolution is proposed (ADR-0006)',
        },
        proposedResolution: null,
        // The group's lowest legacy id, so the console has a patient to hang the item on. It is
        // not a proposed survivor: which row survives is exactly what the reviewer decides.
        patientId: context.patientIds.get(legacyIds[0] as string) ?? null,
        intakeId: null,
        field: null,
        dedupeKey: dedupeKey([
          'identity_conflict',
          'row',
          `legacy_patient:${legacyIds.join('+')}`,
          null,
          `IDENTITY_TIER_${tier}`,
          matched.join(','),
        ]),
      };
    });
}
