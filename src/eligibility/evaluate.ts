// The deterministic eligibility engine (§3B, R-B5 to R-B12). Pure: no I/O, no database, no clock,
// and no threshold or term of its own — every value comes from the ruleset it is handed, so the
// stored `rulesetVersion` is enough to reproduce an evaluation (ADR-0010).
import type { RejectRule, Rules } from '@/rules/schema';

import { matchTerms, type TermMatch } from './terms';
import type { EligibilityInput, EligibilityOutcome, EligibilityResult, MatchedRule } from './types';

/** A reject that fired, with its reason text so the resolution line can quote it. */
interface Reject {
  readonly rule: RejectRule;
  readonly text: string;
}

function positiveFinite(value: number | null, field: string): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be a positive finite number: ${value}`);
  }
  return value;
}

function wholeYears(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`ageYears must be a whole number of years, not negative: ${value}`);
  }
  return value;
}

/**
 * One decimal, widened until the value shown still satisfies the comparison the reason states.
 * Without this, a BMI of 26.99 would be explained as "BMI 27.0 below 27" — display rounding must
 * not make an explanation contradict the rule it explains (Q2).
 */
function formatBmi(bmi: number, holds: (shown: number) => boolean): string {
  for (let digits = 1; digits <= 4; digits += 1) {
    const shown = bmi.toFixed(digits);
    if (holds(Number(shown))) return shown;
  }
  return String(bmi);
}

const quote = (matches: readonly TermMatch[]): string =>
  matches.map((match) => match.text).join('; ');

/**
 * A stored BMI as a screen shows it: one decimal (Q2's default — the thresholds compare the
 * unrounded value, and rounding is for display), widened until the value shown sits on the same
 * side of every threshold as the exact one.
 *
 * Exported because the reasons above are already formatted this way, and a panel showing the
 * input next to those reasons has to agree with them: the same evaluation reading `27.0` on the
 * input line and `BMI 26.99 below 27` on the next is the contradiction `formatBmi` exists to
 * prevent, moved one line up rather than fixed.
 */
export function showBmi(bmi: number, rules: Rules): string {
  const band = rules.bmi.flag_band;
  const below = bmi < rules.bmi.reject_below;
  const banded = inBand(bmi, band);
  return formatBmi(
    bmi,
    (shown) => shown < rules.bmi.reject_below === below && inBand(shown, band) === banded,
  );
}

function missingMetrics(weightKg: number | null, heightCm: number | null): string | null {
  if (weightKg === null && heightCm === null) return 'weight and height';
  if (weightKg === null) return 'weight';
  if (heightCm === null) return 'height';
  return null;
}

export function evaluate(input: EligibilityInput, rules: Rules): EligibilityResult {
  const ageYears = wholeYears(input.ageYears);
  const weightKg = positiveFinite(input.weightKg, 'weightKg');
  const heightCm = positiveFinite(input.heightCm, 'heightCm');
  // Integer arithmetic, not `weightKg / (heightCm / 100) ** 2`: dividing the height by 100 first
  // is inexact for most heights, which moved BMIs that are mathematically 30.0 to either side of
  // an inclusive band boundary (86.7 kg at 170 cm cleared, 76.8 kg at 160 cm flagged). Multiplying
  // by 10000 instead keeps every one-decimal weight at an integer height exact (see the grid in
  // `evaluate.test.ts`), so identical BMIs cannot get different outcomes.
  const bmi =
    weightKg === null || heightCm === null ? null : (weightKg * 10000) / (heightCm * heightCm);

  // The two clinical lists only ever add a flag, so they read the free-text answer as well. The
  // weight-related list can suppress a flag, so it reads the structured answer only (ADR-0005).
  const glp1 = matchTerms(input.medications, rules.glp1_terms);
  const flagConditions = matchTerms(
    [...input.conditions, ...input.conditionsOther],
    rules.flag_condition_terms,
  );
  const weightRelated = matchTerms(input.conditions, rules.weight_related_condition_terms);

  // Every rule is evaluated; nothing short-circuits, so every match contributes its reason (Q1).
  const reasons: string[] = [];
  const matched: MatchedRule[] = [];
  const rejects: Reject[] = [];
  let flagged = false;

  const missing = missingMetrics(weightKg, heightCm);
  const band = rules.bmi.flag_band;

  if (ageYears === null) {
    reasons.push('age not evaluated: date of birth missing');
  } else if (ageYears < rules.age.minimum_years) {
    const text = `age ${ageYears} at submission`;
    rejects.push({ rule: 'age_below_minimum', text });
    matched.push('age_below_minimum');
    reasons.push(`rejected: ${text}`);
  }

  if (bmi === null) {
    reasons.push(`BMI not evaluated: ${missing} missing`);
  } else if (bmi < rules.bmi.reject_below) {
    const shown = formatBmi(bmi, (value) => value < rules.bmi.reject_below);
    const text = `BMI ${shown} below ${rules.bmi.reject_below}`;
    rejects.push({ rule: 'bmi_below_minimum', text });
    matched.push('bmi_below_minimum');
    reasons.push(`rejected: ${text}`);
  } else if (inBand(bmi, band)) {
    const shown = formatBmi(bmi, (value) => inBand(value, band));
    if (weightRelated.length === 0) {
      flagged = true;
      matched.push('bmi_band_without_condition');
      reasons.push(`flagged: BMI ${shown} with no weight-related condition`);
    } else {
      reasons.push(
        `note: BMI ${shown} in the ${band.min}–${band.max} band, ` +
          `weight-related condition present (${quote(weightRelated)})`,
      );
    }
  }

  // The rule fires on the patient's own answer as well as on a matched term (ADR-0015 item 6):
  // the ruleset's list defines which drugs we recognise, not whether the patient is taking one.
  // When both are present the matched text is the better evidence and is what the reason quotes.
  if (input.glp1Declared || glp1.length > 0) {
    flagged = true;
    matched.push('glp1_medication');
    const evidence = glp1.length > 0 ? quote(glp1) : 'declared by patient';
    reasons.push(`flagged: current GLP-1 medication (${evidence})`);
  }

  if (flagConditions.length > 0) {
    flagged = true;
    matched.push('flag_condition');
    reasons.push(
      `flagged: self-reported history of thyroid cancer / pancreatitis (${quote(flagConditions)})`,
    );
  }

  // The age rule and the BMI rules each need an input that can be missing; when one is, that rule
  // did not run, and the evaluation cannot end in a clearing (ADR-0010).
  const unevaluated = ageYears === null || bmi === null;
  const outcome = resolve(rejects, flagged, unevaluated, rules, reasons);
  return {
    outcome,
    reasons,
    matched,
    inputs: {
      ageYears,
      weightKg,
      heightCm,
      bmi,
      glp1Declared: input.glp1Declared,
      glp1,
      flagConditions,
      weightRelated,
    },
    rulesetVersion: rules.version,
  };
}

const inBand = (bmi: number, band: Rules['bmi']['flag_band']): boolean =>
  (band.min_inclusive ? bmi >= band.min : bmi > band.min) &&
  (band.max_inclusive ? bmi <= band.max : bmi < band.max);

/**
 * Q1's default, read from the ruleset: an absolute reject wins outright, any other reject yields
 * to a flag so that a human decides, and a yielding reject keeps its reason and gains a line
 * saying why the outcome is not a rejection. A rule that could not run removes the clearing but
 * changes nothing else. Appends the resolution or clearing line to `reasons`.
 */
function resolve(
  rejects: readonly Reject[],
  flagged: boolean,
  unevaluated: boolean,
  rules: Rules,
  reasons: string[],
): EligibilityOutcome {
  const { absolute_rejects, flag_preempts_reject } = rules.precedence;
  const absolute = rejects.some((reject) => absolute_rejects.includes(reject.rule));

  if (absolute) return 'auto_rejected';
  if (rejects.length > 0 && flagged && flag_preempts_reject) {
    for (const reject of rejects) {
      reasons.push(`flagged: ${reject.text}, but a flag rule also matched; a human decides`);
    }
    return 'auto_flagged';
  }
  if (rejects.length > 0) return 'auto_rejected';
  if (flagged) return 'auto_flagged';
  // Nothing matched, but not every rule ran: the `not evaluated` lines already say which, and the
  // outcome must not read as a clearing to a caller that switches on it (`CLAUDE.md` §5).
  if (unevaluated) return 'not_evaluable';

  reasons.push('cleared: no rejecting or flagging rule matched');
  return 'auto_cleared';
}
