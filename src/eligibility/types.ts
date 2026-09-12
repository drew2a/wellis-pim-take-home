import type { TermMatch } from './terms';

/**
 * The engine's verdict (§3B, R-B6). A missing input can only remove the possibility of clearing,
 * never cancel a rule that fired on the inputs that are present, so an evaluation that matched no
 * rule while an input was missing is `not_evaluable` rather than `auto_cleared` (ADR-0010).
 *
 * The state machine maps the three `auto_*` outcomes onto an intake state; `not_evaluable` never
 * enters it. The Part B form validates its inputs before `evaluate` runs, and at import the
 * history audit stores the outcome in a shadow row and counts it in the report.
 */
export type EligibilityOutcome =
  'auto_rejected' | 'auto_flagged' | 'auto_cleared' | 'not_evaluable';

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
  readonly inputs: EvaluatedInputs;
  readonly rulesetVersion: string;
}
