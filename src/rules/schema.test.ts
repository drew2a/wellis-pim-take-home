// The rules file is the one place that defines thresholds and term lists (ADR-0005). These
// tests pin what "valid" means at the load boundary: a missing list, an empty list, or a bound
// out of order must fail loudly rather than become a silent default (CLAUDE.md §2).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { RULES_V1_PATH, loadRules, parseRules } from './load';

const source: unknown = JSON.parse(readFileSync(RULES_V1_PATH, 'utf8'));

const omit = (object: Record<string, unknown>, key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(object).filter(([k]) => k !== key));

/** The rules file without one top-level key or one nested `a.b` key. */
const without = (path: string): unknown => {
  const copy = structuredClone(source) as Record<string, unknown>;
  const [head, tail] = path.split('.') as [string, string | undefined];
  if (tail === undefined) {
    return omit(copy, head);
  }
  return { ...copy, [head]: omit(copy[head] as Record<string, unknown>, tail) };
};

describe('rules/v1.json', () => {
  it('loads and carries the ADR-0005 values', () => {
    const rules = loadRules();
    expect(rules.version).toBe('v1');
    expect(rules.plausibility.weight_kg).toEqual({ min: 30, max: 300 });
    expect(rules.plausibility.height_cm).toEqual({ min: 100, max: 230 });
    expect(rules.weight_divergence.tolerance).toEqual({ min: 0.9, max: 1.1 });
    expect(rules.age.minimum_years).toBe(18);
    // Q2 default: 27.0 <= BMI <= 30.0 flags, unrounded.
    expect(rules.bmi).toEqual({
      reject_below: 27,
      flag_band: { min: 27, max: 30, min_inclusive: true, max_inclusive: true },
      rounding: 'none',
    });
    expect(rules.glp1_terms).toContain('semaglutide');
    expect(rules.glp1_terms).toContain('bydureon');
    expect(rules.flag_condition_terms).toHaveLength(6);
    expect(rules.weight_related_condition_terms).toHaveLength(7);
    // Q1 default (ADR-0010): every rule is evaluated, age under 18 is the one absolute reject.
    expect(rules.precedence).toEqual({
      absolute_rejects: ['age_below_minimum'],
      flag_preempts_reject: true,
    });
  });

  it.each([
    'glp1_terms',
    'flag_condition_terms',
    'weight_related_condition_terms',
    'plausibility.weight_kg',
    'plausibility.height_cm',
    'weight_divergence',
    'age',
    'bmi',
    'precedence',
    'precedence.absolute_rejects',
    'precedence.flag_preempts_reject',
  ])('fails when %s is missing', (path) => {
    expect(() => parseRules(without(path))).toThrow(/rules file is invalid/);
  });

  it('fails when a term list is empty', () => {
    const copy = structuredClone(source) as Record<string, unknown>;
    copy.glp1_terms = [];
    expect(() => parseRules(copy)).toThrow(/rules file is invalid/);
  });

  it('fails when a term is not lowercase, because matching lowercases the input first', () => {
    const copy = structuredClone(source) as Record<string, unknown>;
    copy.flag_condition_terms = ['Pancreatitis'];
    expect(() => parseRules(copy)).toThrow(/rules file is invalid/);
  });

  it('fails when a term has no letter or digit, because it would match every segment', () => {
    const copy = structuredClone(source) as Record<string, unknown>;
    copy.glp1_terms = ['-'];
    expect(() => parseRules(copy)).toThrow(/rules file is invalid/);
  });

  it('fails when a bound is out of order', () => {
    const copy = structuredClone(source) as { plausibility: { weight_kg: unknown } };
    copy.plausibility.weight_kg = { min: 300, max: 30 };
    expect(() => parseRules(copy)).toThrow(/rules file is invalid/);
  });

  it('fails when the flag band is out of order', () => {
    const copy = structuredClone(source) as { bmi: { flag_band: Record<string, unknown> } };
    copy.bmi.flag_band = { ...copy.bmi.flag_band, min: 30, max: 27 };
    expect(() => parseRules(copy)).toThrow(/rules file is invalid/);
  });

  // The engine rejects before it considers the band, so this ruleset would reject every patient
  // between 27 and 30 rather than flag them, with no other test failing (ADR-0010).
  it('fails when reject_below would make the flag band unreachable', () => {
    const copy = structuredClone(source) as { bmi: { reject_below: number } };
    copy.bmi.reject_below = 30;
    expect(() => parseRules(copy)).toThrow(/rules file is invalid/);
  });

  it.each([0, -18, 17.5])('fails when the minimum age is %s', (minimum) => {
    const copy = structuredClone(source) as { age: { minimum_years: number } };
    copy.age.minimum_years = minimum;
    expect(() => parseRules(copy)).toThrow(/rules file is invalid/);
  });

  it('fails when absolute_rejects names a rule that is not a reject rule', () => {
    const copy = structuredClone(source) as { precedence: { absolute_rejects: unknown } };
    copy.precedence.absolute_rejects = ['glp1_medication'];
    expect(() => parseRules(copy)).toThrow(/rules file is invalid/);
  });

  it('fails when the version is not v1', () => {
    const copy = structuredClone(source) as Record<string, unknown>;
    copy.version = 'v2';
    expect(() => parseRules(copy)).toThrow(/rules file is invalid/);
  });
});
