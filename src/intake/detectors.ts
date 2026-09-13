// The detectors that run on a submission (ADR-0015 item 7). New data gets the same scrutiny as
// legacy data (`CLAUDE.md` §5), so both produce ordinary `review_items` rows through the same
// draft type and the same dedupe rules as the importer's.
//
// Neither blocks the submission: the patient completes their intake, the engine runs, the intake
// enters the machine, and a human gets a decision to make afterwards.
import { keysOf, type CandidateKey, type IdentityRow } from '@/import/identity/candidates';
import { dedupeKey, type ReviewItemDraft } from '@/import/review/items';
import { maskIdentifier } from '@/repo/mask';

/** A patient already in the database that shares a candidate key with the new one. */
export interface PatientMatch {
  readonly row: IdentityRow;
  readonly patientId: string;
  /** Set when the match has since been merged into another patient, so the reviewer can follow it. */
  readonly mergedInto: string | null;
}

/** The patient fields a reviewer compares, with identifiers masked as in every jsonb payload. */
function sideBySide(row: IdentityRow): Record<string, unknown> {
  return {
    full_name: row.fullName,
    dob: row.dob,
    email: row.email,
    // Masked like every other identifier in a payload (ADR-0009 item 9); the console reveals it
    // from `patients.bsn`, where column-level masking applies.
    bsn: row.bsn === null ? null : maskIdentifier(row.bsn),
    phone: row.phone,
    city: row.city,
    status: row.status,
    signup_date: row.signupDate,
    source: row.source,
  };
}

/** The key kinds the new patient and an existing one have in common, in kind order. */
export function sharedKeys(a: IdentityRow, b: IdentityRow): CandidateKey[] {
  const theirs = new Set(keysOf(b).map((key) => `${key.kind}:${key.value}`));
  return keysOf(a)
    .filter((key) => theirs.has(`${key.kind}:${key.value}`))
    .sort((left, right) => (left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0));
}

/**
 * One item when a submission looks like a patient we already have (ADR-0015 item 7).
 *
 * Never a merge: `CLAUDE.md` §5 allows the importer's tier 1 only for records literally identical
 * on identity *and* non-contradictory on everything else, which a fresh submission against a
 * legacy record is not — the submission carries no bsn, no phone and no city to be identical on.
 * Never a block either: whether two people are one person is a reviewer's decision, and it is not
 * worth making a patient wait for it.
 *
 * The `dedupe_key` names the new patient's uuid where the importer would use a natural key: a
 * new-flow entity has none (ADR-0009 item 3), and the "same key on every run" argument that
 * motivated natural keys is about re-imports, not about a submission that happens once.
 */
export function possibleExistingPatientItem(
  newPatientId: string,
  newRow: IdentityRow,
  matches: readonly PatientMatch[],
): ReviewItemDraft | null {
  if (matches.length === 0) return null;
  const kinds = [...new Set(matches.flatMap((m) => sharedKeys(newRow, m.row).map((k) => k.kind)))];
  return {
    type: 'identity_conflict',
    scope: 'row',
    title: 'a new intake may be from a patient we already have',
    reason: `matched on ${kinds.join(', ')}`,
    payload: {
      matched_keys: kinds,
      submitted: sideBySide(newRow),
      existing: matches.map((match) => ({
        patient_id: match.patientId,
        legacy_id: match.row.legacyId,
        // Where the record lives now: a match that was merged away is answered by its survivor.
        merged_into: match.mergedInto,
        matched_keys: sharedKeys(newRow, match.row).map((key) => key.kind),
        ...sideBySide(match.row),
      })),
      actions: ['merge_with_chosen_values', 'not_the_same_person'],
      note: 'the intake was accepted and evaluated; this item is only about who the patient is',
    },
    proposedResolution: null,
    patientId: newPatientId,
    intakeId: null,
    field: null,
    dedupeKey: dedupeKey([
      'identity_conflict',
      'row',
      `patient:${newPatientId}`,
      null,
      'POSSIBLE_EXISTING_PATIENT',
      kinds.join(','),
    ]),
  };
}

/**
 * One item when a patient reports current GLP-1 use and names a drug the ruleset does not know
 * (ADR-0015 item 7).
 *
 * The intake is already `auto_flagged` — the declaration is an engine input (item 6) — so this
 * item is not about that patient. It asks the *ruleset* a question: should this name be in
 * `glp1_terms` in v2? That is one vocabulary-level decision however many patients name the same
 * drug, which is why the scope is `vocabulary`, the entity is the term list, and the key is the
 * folded text: the hundredth patient naming it adds no item (`CLAUDE.md` §5, ADR-0009 item 8).
 */
export function unmatchedGlp1Item(
  declaredText: string,
  firstIntakeId: string,
  rulesetVersion: string,
): ReviewItemDraft {
  const folded = declaredText.trim().toLowerCase().replace(/\s+/gu, ' ');
  return {
    type: 'vocabulary',
    scope: 'vocabulary',
    title: `a patient named a GLP-1 medication the ruleset does not know: ${folded}`,
    reason: `declared current GLP-1 use; no term of glp1_terms matched "${declaredText}"`,
    payload: {
      declared_text: declaredText,
      folded,
      ruleset_version: rulesetVersion,
      term_list: 'glp1_terms',
      first_seen_intake_id: firstIntakeId,
      question: `add "${folded}" to glp1_terms in the next ruleset version?`,
      note: 'the intake was flagged on the declaration itself, so no patient is waiting on this',
    },
    proposedResolution: null,
    // A vocabulary decision hangs on the term list, not on the patient who happened to trigger it.
    patientId: null,
    intakeId: null,
    field: null,
    dedupeKey: dedupeKey([
      'vocabulary',
      'vocabulary',
      'ruleset:glp1_terms',
      null,
      'NEW_GLP1_DECLARED_UNMATCHED',
      folded,
    ]),
  };
}
