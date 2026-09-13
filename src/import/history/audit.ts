// The history audit of ADR-0005: every Part B rule runs over every legacy intake at import, and
// almost none of it becomes a review item.
//
// The doctor who approved a 2024 intake saw its BMI. A BMI disagreement is therefore a fact about
// our rules, not an open question about that patient: it is a shadow evaluation the console can
// browse and a figure in the import report. Items exist only where the legacy process **could not
// see** the problem — a GLP-1 medication or a flag condition buried in free text — or where it is
// **a legal one**: an intake from someone under 18 whose outcome is not a rejection.
import { ageInYears } from '@/eligibility/age';
import { evaluate } from '@/eligibility/evaluate';
import type { EligibilityResult, MatchedRule } from '@/eligibility/types';
import type { Rules } from '@/rules/schema';

import type { MappedIntake } from '../mapper/intake';
import type { MappedPatient } from '../mapper/patient';
import { dedupeKey, type ReviewItemDraft } from '../review/items';
import type { Ids } from '../review/mapping-items';

export interface ShadowEvaluation {
  readonly intakeId: string;
  readonly legacyPatientId: string;
  /** The legacy outcome the shadow verdict is compared with in the report. */
  readonly legacyOutcome: string;
  readonly result: EligibilityResult;
}

/**
 * One evaluation per legacy intake, `not_evaluable` included: an intake the rules could not judge
 * is a fact the report counts, not a row to skip (ADR-0010).
 *
 * A legacy intake passes its raw `conditions` text as `conditions` and nothing as
 * `conditionsOther` (ADR-0010): the legacy form had no checklist, so its free text is the
 * authoritative answer and may suppress the band flag as a checklist answer would.
 */
export function evaluateHistory(
  intakes: readonly MappedIntake[],
  patients: readonly MappedPatient[],
  rules: Rules,
): ShadowEvaluation[] {
  const dobByLegacyId = new Map(
    patients.map((patient) => [patient.legacyId, patient.canonical.dob]),
  );
  return intakes.map((intake) => {
    const dob = dobByLegacyId.get(intake.legacyPatientId) ?? null;
    const submittedAt = intake.canonical.submittedAt;
    return {
      intakeId: intake.intakeId,
      legacyPatientId: intake.legacyPatientId,
      legacyOutcome: intake.canonical.outcome,
      result: evaluate(
        {
          ageYears: ageAt(dob, submittedAt),
          weightKg: intake.canonical.weightKg === null ? null : Number(intake.canonical.weightKg),
          heightCm: intake.canonical.heightCm,
          // The legacy questionnaire never asked the question, and inventing a "yes" from free
          // text is what `matchTerms` already does honestly (ADR-0015 item 6).
          glp1Declared: false,
          medications:
            intake.canonical.medsCurrentRaw === null ? [] : [intake.canonical.medsCurrentRaw],
          conditions:
            intake.canonical.conditionsRaw === null ? [] : [intake.canonical.conditionsRaw],
          conditionsOther: [],
        },
        rules,
      ),
    };
  });
}

/**
 * Age at submission (Q4), or null where the two dates cannot produce one the rules can judge.
 * Neither date is guaranteed: 5 patients have no usable date of birth and 3 intakes no usable
 * submission date. A submission that precedes the date of birth is unusable in the same way — it
 * yields a negative age, which the engine refuses (`wholeYears`), and the history audit runs
 * inside the run transaction, so one such row would abort the whole import instead of producing
 * an evaluation. All three read as an age the rules could not judge rather than as a patient who
 * passed the age rule (ADR-0012 item 4).
 */
function ageAt(dob: string | null, submittedAt: string | null): number | null {
  // ISO dates compare lexicographically, which is why both columns are dates and not parsed values.
  if (dob === null || submittedAt === null || submittedAt < dob) return null;
  return ageInYears(dob, submittedAt);
}

/**
 * The legacy outcomes for which a minor's intake is a legal question rather than history.
 * `unknown` is one of them: the spelling could not be read, so the intake sits in `legacy_pending`,
 * the one non-terminal legacy state (ADR-0009 item 8), and nobody can say what the legacy process
 * decided — which is at least as open as a `pending` one. Leaving it out failed open on the single
 * class ADR-0005 queues for legal reasons (ADR-0012 item 5).
 */
const OPEN_OUTCOMES = new Set(['approved', 'pending', 'unknown']);

interface ItemShape {
  readonly title: string;
  readonly rule: string;
  /** The engine's own reason line, quoted verbatim: the console renders legacy and new alike. */
  readonly reasonPrefix: string;
}

const SHAPES: readonly (ItemShape & { readonly matched: MatchedRule })[] = [
  {
    matched: 'glp1_medication',
    title: 'GLP-1 medication reported in free text',
    rule: 'HISTORY_GLP1_MEDICATION',
    reasonPrefix: 'flagged: current GLP-1 medication',
  },
  {
    matched: 'flag_condition',
    title: 'flag condition reported in free text',
    rule: 'HISTORY_FLAG_CONDITION',
    reasonPrefix: 'flagged: self-reported history of',
  },
];

/**
 * Row items derived from the stored evaluations, so history is evaluated once. If Wellis later
 * asks to reopen a class — the BMI band, say — the items are generated from those rows without
 * re-running the rules (ADR-0005).
 */
export function clinicalHistoryItems(
  evaluations: readonly ShadowEvaluation[],
  ids: Ids,
  rules: Rules,
): ReviewItemDraft[] {
  const items: ReviewItemDraft[] = [];
  for (const evaluation of evaluations) {
    for (const shape of SHAPES) {
      if (!evaluation.result.matched.includes(shape.matched)) continue;
      items.push(item(evaluation, shape, reasonFor(evaluation, shape.reasonPrefix), ids));
    }
    const age = evaluation.result.inputs.ageYears;
    // The 12 rejected minors are a report figure: the legacy process saw the age and said no.
    // The other 58 are a legal question that is still open today.
    if (
      age !== null &&
      age < rules.age.minimum_years &&
      OPEN_OUTCOMES.has(evaluation.legacyOutcome)
    ) {
      items.push(
        item(
          evaluation,
          {
            title: `intake from a patient aged ${age}, legacy outcome ${evaluation.legacyOutcome}`,
            rule: 'HISTORY_MINOR_NOT_REJECTED',
            reasonPrefix: 'rejected: age',
          },
          reasonFor(evaluation, 'rejected: age'),
          ids,
        ),
      );
    }
  }
  return items;
}

function reasonFor(evaluation: ShadowEvaluation, prefix: string): string {
  const line = evaluation.result.reasons.find((reason) => reason.startsWith(prefix));
  if (line === undefined) {
    throw new Error(
      `evaluation of ${evaluation.intakeId} matched a rule with no \`${prefix}\` reason`,
    );
  }
  return line;
}

function item(
  evaluation: ShadowEvaluation,
  shape: ItemShape,
  reason: string,
  ids: Ids,
): ReviewItemDraft {
  return {
    type: 'clinical_history',
    scope: 'row',
    title: shape.title,
    reason,
    payload: {
      intake_id: evaluation.intakeId,
      legacy_patient_id: evaluation.legacyPatientId,
      legacy_outcome: evaluation.legacyOutcome,
      shadow_outcome: evaluation.result.outcome,
      reasons: evaluation.result.reasons,
      ruleset_version: evaluation.result.rulesetVersion,
      matched_terms: {
        glp1: evaluation.result.inputs.glp1,
        flag_conditions: evaluation.result.inputs.flagConditions,
      },
      note: 'the legacy outcome stands; this item asks whether it should be revisited',
    },
    proposedResolution: null,
    patientId: ids.patients.get(evaluation.legacyPatientId) ?? null,
    intakeId: ids.intakes.get(evaluation.intakeId) ?? null,
    field: null,
    dedupeKey: dedupeKey([
      'clinical_history',
      'row',
      `legacy_intake:${evaluation.intakeId}`,
      null,
      shape.rule,
      evaluation.result.rulesetVersion,
    ]),
  };
}
