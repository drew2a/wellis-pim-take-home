// Numeric columns. Weight: `weight_kg` to one decimal, kilograms stored unchanged, pounds
// converted with WEIGHT_LBS_TO_KG, a missing unit blanked (ADR-0005). Height: integer
// centimetres. Alcohol: integer units. The plausibility bounds come from rules/v1.json and the
// mapper applies them with IMPLAUSIBLE_TO_NULL (ADR-0009 item 2); the detectors branch owes the
// review items. A value that is not a number of the column's shape is blanked with
// NON_NUMERIC_TO_NULL and flagged.
import type { Rules } from '@/rules/schema';

import { mapped, unchanged, type Flag, type Mapped, type RecordDraft } from './types';

const LBS_TO_KG = 0.45359237;
const DECIMAL = /^[0-9]+(?:\.[0-9])?$/u;
const INTEGER = /^[0-9]+$/u;

type Bounds = Rules['plausibility']['weight_kg'];

/** One decimal, as the numeric(5,1) column stores it, with `.0` written out. */
export function oneDecimal(value: number): string {
  return value.toFixed(1);
}

function nonNumeric(field: string, raw: string): Mapped<null> {
  return mapped(
    null,
    [{ field, from: raw, to: null, ruleCode: 'NON_NUMERIC_TO_NULL' }],
    [{ kind: 'non_numeric', field, raw }],
  );
}

function withinBounds(
  field: 'weight_kg' | 'height_cm',
  raw: string,
  current: string,
  value: number,
  bounds: Bounds,
  records: RecordDraft[],
): Mapped<string | null> {
  if (value >= bounds.min && value <= bounds.max) {
    return mapped(current, records);
  }
  records.push({
    field,
    from: current,
    to: null,
    ruleCode: 'IMPLAUSIBLE_TO_NULL',
    detail: { bounds },
  });
  const flag: Flag = { kind: 'implausible', field, raw, value };
  return mapped(null, records, [flag]);
}

export type WeightUnit = 'kg' | 'lbs' | '';

/**
 * Patient weight with its unit column. The canonical `weight_kg` string is what the numeric
 * column stores; records chain from raw to converted to null where several rules apply.
 */
export function mapPatientWeight(
  rawWeight: string,
  rawUnit: string,
  bounds: Bounds,
): Mapped<string | null> {
  if (rawWeight === '') return unchanged(null);
  if (!DECIMAL.test(rawWeight)) return nonNumeric('weight_kg', rawWeight);
  const records: RecordDraft[] = [];
  if (rawUnit === '') {
    records.push({
      field: 'weight_kg',
      from: rawWeight,
      to: null,
      ruleCode: 'WEIGHT_UNIT_MISSING_TO_NULL',
    });
    return mapped(null, records, [
      { kind: 'weight_unit_missing', field: 'weight_kg', raw: rawWeight },
    ]);
  }
  if (rawUnit !== 'kg' && rawUnit !== 'lbs') {
    records.push({ field: 'weight_unit', from: rawUnit, to: null, ruleCode: 'VOCAB_UNKNOWN' });
    return mapped(null, records, [
      { kind: 'vocabulary_unseen', field: 'weight_unit', raw: rawUnit },
    ]);
  }
  let current = oneDecimal(Number(rawWeight));
  if (rawUnit === 'lbs') {
    const kg = oneDecimal(Number(rawWeight) * LBS_TO_KG);
    records.push({
      field: 'weight_kg',
      from: rawWeight,
      to: kg,
      ruleCode: 'WEIGHT_LBS_TO_KG',
      detail: { factor: LBS_TO_KG },
    });
    current = kg;
  }
  return withinBounds('weight_kg', rawWeight, current, Number(current), bounds, records);
}

/** Intake weight: kilograms by documented assumption (ADR-0005), no unit column. */
export function mapIntakeWeight(raw: string, bounds: Bounds): Mapped<string | null> {
  if (raw === '') return unchanged(null);
  if (!DECIMAL.test(raw)) return nonNumeric('weight_kg', raw);
  const current = oneDecimal(Number(raw));
  return withinBounds('weight_kg', raw, current, Number(current), bounds, []);
}

export function mapHeight(raw: string, bounds: Bounds): Mapped<number | null> {
  if (raw === '') return unchanged(null);
  if (!INTEGER.test(raw)) return nonNumeric('height_cm', raw);
  const value = Number(raw);
  const result = withinBounds('height_cm', raw, raw, value, bounds, []);
  return mapped(result.value === null ? null : value, result.records, result.flags);
}

/** `n.v.t.` and any other non-integer is null with a record; empty is null without (findings). */
export function mapAlcoholUnits(raw: string): Mapped<number | null> {
  if (raw === '') return unchanged(null);
  if (!INTEGER.test(raw)) return nonNumeric('alcohol_units_week', raw);
  return unchanged(Number(raw));
}
