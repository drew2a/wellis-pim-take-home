// The two weight detectors of ADR-0005, and the item the weight-unit mapping owes.
//
// R-A36 is the reason both are shaped the way they are: divergence between the signup weight and
// an intake weight is legitimate — the patient weighed themselves again — so these detectors do
// not report divergence. They report the rows the rest of the file cannot explain: a weight that
// moved further than 2684 of 2688 intakes ever moved, and a unit column the export left empty.
import type { Rules } from '@/rules/schema';

import { isDecimal } from '../mapper/numbers';
import { RULE_CODES } from '../mapper/rule-codes';
import { dedupeKey, type ReviewItemDraft } from '../review/items';
import type { Ids } from '../review/mapping-items';

const LBS_TO_KG = 0.45359237;

export type WeightUnit = 'kg' | 'lbs' | '';

export interface WeightRow {
  readonly legacyId: string;
  /** The raw `weight` cell, which the unit-less item quotes and reads both ways. */
  readonly rawWeight: string;
  readonly rawUnit: string;
  /** Canonical kilograms; null when the unit was missing or the value implausible. */
  readonly weightKg: string | null;
  readonly heightCm: number | null;
  readonly intakes: readonly { readonly intakeId: string; readonly weightKg: string | null }[];
}

/** BMI to one decimal, for a payload a human reads; the engine's own BMI is never rounded (Q2). */
function bmi(weightKg: number, heightCm: number | null): number | null {
  if (heightCm === null || heightCm <= 0) return null;
  return Number(((weightKg * 10000) / (heightCm * heightCm)).toFixed(1));
}

/**
 * The 18 rows whose `weight_unit` is empty: the mapper stored null (`WEIGHT_UNIT_MISSING_TO_NULL`)
 * rather than guess, and one vocabulary item asks the question once, with both readings and both
 * BMIs per row so the operator can see which one is a person. The operator may exclude rows before
 * applying, which is why the payload lists them (ADR-0005).
 */
export function unitMissingItem(rows: readonly WeightRow[]): ReviewItemDraft | null {
  // `isDecimal`, not `!== ''`: the mapper blanks a weight that is not a number before the
  // missing-unit rule can ever run on it (`NON_NUMERIC_TO_NULL`), so such a row carries no
  // question for this item — and reading it both ways would put `NaN` in the payload and ask a
  // reviewer whether a value that is not a number is in pounds.
  const affected = rows.filter((row) => row.rawUnit === '' && isDecimal(row.rawWeight));
  if (affected.length === 0) return null;
  return {
    type: 'vocabulary',
    scope: 'vocabulary',
    title: `weight_unit is empty on ${affected.length} rows: are they pounds?`,
    reason: 'stored null until answered; the raw value and both readings are below',
    payload: {
      evidence: RULE_CODES.WEIGHT_UNIT_MISSING_TO_NULL,
      factor: LBS_TO_KG,
      rows: affected.map((row) => {
        const asKg = Number(row.rawWeight);
        const asLbs = Number((asKg * LBS_TO_KG).toFixed(1));
        return {
          legacy_id: row.legacyId,
          raw_weight: row.rawWeight,
          height_cm: row.heightCm,
          as_kilograms: { weight_kg: asKg.toFixed(1), bmi: bmi(asKg, row.heightCm) },
          as_pounds: { weight_kg: asLbs.toFixed(1), bmi: bmi(asLbs, row.heightCm) },
        };
      }),
    },
    proposedResolution: {
      field: 'weight_kg',
      proposed_value: 'raw × 0.45359237',
      rule: 'WEIGHT_UNIT_ASSUMED_POUNDS',
      evidence: RULE_CODES.WEIGHT_UNIT_MISSING_TO_NULL,
    },
    patientId: null,
    intakeId: null,
    field: 'weight_kg',
    dedupeKey: dedupeKey([
      'vocabulary',
      'vocabulary',
      'rule',
      'weight_kg',
      'WEIGHT_UNIT_MISSING_TO_NULL',
      'confirm',
    ]),
  };
}

interface Divergence {
  readonly intakeId: string;
  readonly intakeWeightKg: string;
  readonly ratio: number;
}

/**
 * The intakes of this patient whose weight leaves the tolerance — but only when **every**
 * comparable intake does (findings, weight): one intake out of four that disagrees is a patient
 * who weighed themselves on a bad day, which R-A36 says is legitimate; a signup weight that
 * disagrees with everything the patient ever reported is a value the file cannot explain.
 */
function divergences(
  row: WeightRow,
  tolerance: Rules['weight_divergence']['tolerance'],
): Divergence[] {
  const signup = row.weightKg === null ? null : Number(row.weightKg);
  if (signup === null || signup <= 0) return [];
  const comparable = row.intakes.filter((intake) => intake.weightKg !== null);
  const outside = outsideTolerance(row, signup, tolerance);
  return comparable.length > 0 && outside.length === comparable.length ? outside : [];
}

function outsideTolerance(
  row: WeightRow,
  signup: number,
  tolerance: Rules['weight_divergence']['tolerance'],
): Divergence[] {
  return row.intakes.flatMap((intake) => {
    if (intake.weightKg === null) return [];
    const ratio = Number(intake.weightKg) / signup;
    if (ratio >= tolerance.min && ratio <= tolerance.max) return [];
    return [
      {
        intakeId: intake.intakeId,
        intakeWeightKg: intake.weightKg,
        ratio: Number(ratio.toFixed(3)),
      },
    ];
  });
}

/**
 * Row items for `kg` rows only (3 patients here). The tolerance is derived from those rows —
 * 2684 of 2688 intakes are inside it — so a `kg` row outside it is a fact about that patient that
 * the rest of the file does not explain. `lbs` rows are a different question and get one item.
 */
export function divergenceItems(
  rows: readonly WeightRow[],
  rules: Rules,
  ids: Ids,
): ReviewItemDraft[] {
  const tolerance = rules.weight_divergence.tolerance;
  return rows.flatMap((row) => {
    if (row.rawUnit !== 'kg') return [];
    const found = divergences(row, tolerance);
    if (found.length === 0) return [];
    return [
      {
        type: 'data_quality' as const,
        scope: 'row' as const,
        title: 'signup weight and intake weight diverge beyond the tolerance',
        reason:
          `signup ${row.weightKg} kg against ${found.map((d) => `${d.intakeWeightKg} kg (×${d.ratio})`).join(', ')}; ` +
          `${tolerance.min}–${tolerance.max} covers 2684 of 2688 intakes`,
        payload: {
          legacy_id: row.legacyId,
          signup_weight_kg: row.weightKg,
          tolerance,
          intakes: found.map((d) => ({
            intake_id: d.intakeId,
            weight_kg: d.intakeWeightKg,
            ratio: d.ratio,
          })),
          note: 'a real change of weight is legitimate (R-A36); this is a value the file cannot explain',
        },
        proposedResolution: null,
        patientId: ids.patients.get(row.legacyId) ?? null,
        intakeId: null,
        field: 'weight_kg',
        dedupeKey: dedupeKey([
          'data_quality',
          'row',
          `legacy_patient:${row.legacyId}`,
          'weight_kg',
          'WEIGHT_DIVERGENCE',
          found
            .map((d) => d.intakeId)
            .sort()
            .join(','),
        ]),
      },
    ];
  });
}

/**
 * One vocabulary item, not one per row: that `lbs` rows do not reconcile with their own intakes is
 * a single finding about a unit spelling, and 49 identical items would be 49 copies of one
 * question (`CLAUDE.md` §5).
 */
export function lbsReconciliationItem(
  rows: readonly WeightRow[],
  rules: Rules,
  ids: Ids,
): ReviewItemDraft | null {
  const tolerance = rules.weight_divergence.tolerance;
  const lbs = rows.filter((row) => row.rawUnit === 'lbs');
  const comparable = lbs.filter(
    (row) => row.weightKg !== null && row.intakes.some((intake) => intake.weightKg !== null),
  );
  const diverging = comparable.filter((row) => divergences(row, tolerance).length > 0);
  if (diverging.length === 0) return null;
  const intakesCompared = comparable.reduce(
    (n, row) => n + row.intakes.filter((intake) => intake.weightKg !== null).length,
    0,
  );
  const intakesOutside = comparable.reduce(
    (n, row) => n + outsideTolerance(row, Number(row.weightKg), tolerance).length,
    0,
  );
  return {
    type: 'vocabulary',
    scope: 'vocabulary',
    title: `weight_unit \`lbs\`: ${intakesOutside} of ${intakesCompared} intakes do not reconcile after conversion`,
    reason:
      'converted with 0.45359237 the signup weight leaves the tolerance the kg rows support; ' +
      'either the unit label or the intake weight is wrong for these rows',
    payload: {
      evidence: RULE_CODES.WEIGHT_LBS_TO_KG,
      tolerance,
      intakes_compared: intakesCompared,
      intakes_outside: intakesOutside,
      patients_compared: comparable.length,
      patients_disagreeing: diverging.length,
      rows: diverging.map((row) => ({
        legacy_id: row.legacyId,
        raw_weight: row.rawWeight,
        converted_weight_kg: row.weightKg,
        intakes: divergences(row, tolerance).map((d) => ({
          intake_id: d.intakeId,
          weight_kg: d.intakeWeightKg,
          ratio: d.ratio,
        })),
        patient_id: ids.patients.get(row.legacyId) ?? null,
      })),
    },
    proposedResolution: null,
    patientId: null,
    intakeId: null,
    field: 'weight_kg',
    dedupeKey: dedupeKey([
      'vocabulary',
      'vocabulary',
      'rule',
      'weight_kg',
      'WEIGHT_LBS_DO_NOT_RECONCILE',
      'confirm',
    ]),
  };
}
