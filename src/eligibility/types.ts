import type { TermMatch } from './terms';

/**
 * The engine's verdict (§3B, R-B6), as a list so that the `engine_outcome` database enum is
 * generated from it and cannot drift (ADR-0011 item 1).
 *
 * A missing input can only remove the possibility of clearing, never cancel a rule that fired on
 * the inputs that are present, so an evaluation that matched no rule while an input was missing is
 * `not_evaluable` rather than `auto_cleared` (ADR-0010).
 *
 * The state machine maps the three `auto_*` outcomes onto an intake state; `not_evaluable` never
 * enters it. The Part B form validates its inputs before `evaluate` runs, and at import the
 * history audit stores the outcome in a shadow row and counts it in the report.
 */
export const ELIGIBILITY_OUTCOMES = [
  'auto_rejected',
  'auto_flagged',
  'auto_cleared',
  'not_evaluable',
] as const;

export type EligibilityOutcome = (typeof ELIGIBILITY_OUTCOMES)[number];

export interface EligibilityInput {
  /**
   * Whole years at the reference date (Q4: submission), measured by the caller with `ageInYears`;
   * null
   * when the date of birth is unusable (5 patients in this export have a future one).
   */
  readonly ageYears: number | null;
  /** Null when the value was missing or implausible: the mapper nulls it, the engine sees null. */
  readonly weightKg: number | null;
  readonly heightCm: number | null;
  readonly medications: readonly string[];
  /** The authoritative answer: matched for flag terms and for weight-related terms. */
  readonly conditions: readonly string[];
  /** Free text: matched for flag terms only, so it can add a flag but never clear one (ADR-0005). */
  readonly conditionsOther: readonly string[];
}

/**
 * Every rule the engine can report as matched. The two that reject are named by the ruleset's
 * precedence block (`REJECT_RULES`); the three that flag are named here and nowhere else.
 *
 * `matched` exists so that the history audit and the import report ask the engine which rules
 * fired instead of re-deriving it from the thresholds, which would be a second implementation of
 * the rules next to the one that decides (ADR-0011 item 21).
 */
export const MATCHED_RULES = [
  'age_below_minimum',
  'bmi_below_minimum',
  'bmi_band_without_condition',
  'glp1_medication',
  'flag_condition',
] as const;

export type MatchedRule = (typeof MATCHED_RULES)[number];

/** What the rules actually saw, so a stored evaluation explains itself (ADR-0010). */
export interface EvaluatedInputs {
  readonly ageYears: number | null;
  readonly weightKg: number | null;
  readonly heightCm: number | null;
  /** Unrounded: the thresholds compare this value, rounding is for display only (Q2). */
  readonly bmi: number | null;
  readonly glp1: readonly TermMatch[];
  readonly flagConditions: readonly TermMatch[];
  readonly weightRelated: readonly TermMatch[];
}

export interface EligibilityResult {
  readonly outcome: EligibilityOutcome;
  readonly reasons: readonly string[];
  /** The rules that fired, in the fixed rule order the reasons follow. */
  readonly matched: readonly MatchedRule[];
  readonly inputs: EvaluatedInputs;
  readonly rulesetVersion: string;
}
