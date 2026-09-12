// The eligibility engine (R-B5 to R-B12, ADR-0010). Every reason string is asserted verbatim:
// they are the text the console shows for legacy and new intakes alike, so a change to one is a
// change to the product, not a refactor.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadRules } from '@/rules/load';

import { evaluate } from './evaluate';
import type { EligibilityInput } from './types';

const rules = loadRules();

// Height 200 cm keeps the arithmetic in these cases readable: a BMI is the weight over four.
const CLEARED: EligibilityInput = {
  ageYears: 40,
  weightKg: 140,
  heightCm: 200,
  medications: [],
  conditions: [],
  conditionsOther: [],
};
const evaluateWith = (patch: Partial<EligibilityInput>) =>
  evaluate({ ...CLEARED, ...patch }, rules);
const CLEAR_LINE = 'cleared: no rejecting or flagging rule matched';

describe('a clearing intake', () => {
  it('clears with an explanation of its own', () => {
    const result = evaluateWith({});
    expect(result.outcome).toBe('auto_cleared');
    expect(result.reasons).toEqual([CLEAR_LINE]);
  });
});

describe('age under 18', () => {
  it('rejects at 17 and clears at 18', () => {
    expect(evaluateWith({ ageYears: 17 })).toMatchObject({
      outcome: 'auto_rejected',
      reasons: ['rejected: age 17 at submission'],
    });
    expect(evaluateWith({ ageYears: 18 })).toMatchObject({
      outcome: 'auto_cleared',
      reasons: [CLEAR_LINE],
    });
  });

  it('uses the brief’s own example wording', () => {
    expect(evaluateWith({ ageYears: 16 }).reasons).toEqual(['rejected: age 16 at submission']);
  });

  it('does not evaluate the rule when the age is unknown, and says so', () => {
    expect(evaluateWith({ ageYears: null })).toMatchObject({
      outcome: 'not_evaluable',
      reasons: ['age not evaluated: date of birth missing'],
    });
  });
});

describe('BMI', () => {
  it('rejects below 27, taking the boundary unrounded', () => {
    // 26.99 rounds to 27.0 at one decimal, so the reason widens rather than contradict itself.
    expect(evaluateWith({ weightKg: 107.96 })).toMatchObject({
      outcome: 'auto_rejected',
      reasons: ['rejected: BMI 26.99 below 27'],
    });
    expect(evaluateWith({ weightKg: 96.4 }).reasons).toEqual(['rejected: BMI 24.1 below 27']);
  });

  it('flags the band, both boundaries inclusive (Q2)', () => {
    expect(evaluateWith({ weightKg: 108 })).toMatchObject({
      outcome: 'auto_flagged',
      reasons: ['flagged: BMI 27.0 with no weight-related condition'],
    });
    expect(evaluateWith({ weightKg: 120 })).toMatchObject({
      outcome: 'auto_flagged',
      reasons: ['flagged: BMI 30.0 with no weight-related condition'],
    });
  });

  // Every height from 150 to 200 cm, not just the one where the arithmetic is convenient: BMI is
  // compared against exact integer thresholds, so the boundary is decided by `1000 * tenths` vs
  // `bmi * height²` — no floating point in the expectation. `86.7 kg` at 170 cm and `76.8 kg` at
  // 160 cm are the weights the old `(heightCm / 100) ** 2` formula drifted on.
  describe.each([
    { boundary: 27, inside: 'auto_flagged', outside: 'auto_rejected' },
    { boundary: 30, inside: 'auto_flagged', outside: 'auto_cleared' },
  ] as const)('the $boundary boundary, at every height', ({ boundary, inside, outside }) => {
    const heights = Array.from({ length: 51 }, (_unused, index) => 150 + index);

    it.each(heights)('holds at %d cm', (heightCm) => {
      const exactTenths = (boundary * heightCm * heightCm) / 1000;
      // The nearest weight in whole tenths of a kilogram on each side of the boundary. A band
      // boundary is inclusive, so the weight that lands exactly on it belongs inside the band.
      const insideTenths = boundary === 27 ? Math.ceil(exactTenths) : Math.floor(exactTenths);
      const outsideTenths = boundary === 27 ? insideTenths - 1 : insideTenths + 1;

      expect(evaluateWith({ heightCm, weightKg: insideTenths / 10 }).outcome).toBe(inside);
      expect(evaluateWith({ heightCm, weightKg: outsideTenths / 10 }).outcome).toBe(outside);

      // Where the boundary weight is a weight a patient can actually type — one decimal — the
      // engine must compute the boundary itself, not a value 4e-15 away from it.
      if (Number.isInteger(exactTenths)) {
        expect(evaluateWith({ heightCm, weightKg: insideTenths / 10 }).inputs.bmi).toBe(boundary);
      }
    });
  });

  it('clears just above the band', () => {
    expect(evaluateWith({ weightKg: 120.04 })).toMatchObject({
      outcome: 'auto_cleared',
      reasons: [CLEAR_LINE],
    });
  });

  it('uses the brief’s own example wording', () => {
    // 27.4 x 4 = 109.6.
    expect(evaluateWith({ weightKg: 109.6 }).reasons).toEqual([
      'flagged: BMI 27.4 with no weight-related condition',
    ]);
  });

  it('does not flag the band when a weight-related condition is reported, and records why', () => {
    // 28.3 x 4 = 113.2.
    expect(evaluateWith({ weightKg: 113.2, conditions: ['hoge bloeddruk'] })).toMatchObject({
      outcome: 'auto_cleared',
      reasons: [
        'note: BMI 28.3 in the 27–30 band, weight-related condition present (hoge bloeddruk)',
        CLEAR_LINE,
      ],
    });
  });

  it('lets free text add a flag but never clear one (ADR-0005)', () => {
    // The same condition, typed into the "other" box instead of answered: the flag stands.
    expect(evaluateWith({ weightKg: 113.2, conditionsOther: ['hoge bloeddruk'] })).toMatchObject({
      outcome: 'auto_flagged',
      reasons: ['flagged: BMI 28.3 with no weight-related condition'],
    });
  });

  it('does not evaluate the rules when a metric is missing, and says which', () => {
    expect(evaluateWith({ weightKg: null })).toMatchObject({
      outcome: 'not_evaluable',
      reasons: ['BMI not evaluated: weight missing'],
    });
    expect(evaluateWith({ heightCm: null }).reasons).toEqual(['BMI not evaluated: height missing']);
    expect(evaluateWith({ weightKg: null, heightCm: null }).reasons).toEqual([
      'BMI not evaluated: weight and height missing',
    ]);
  });
});

describe('GLP-1 medication', () => {
  it('flags, quoting the text as typed', () => {
    expect(evaluateWith({ medications: ['Ozempic 0,5 mg'] })).toMatchObject({
      outcome: 'auto_flagged',
      reasons: ['flagged: current GLP-1 medication (Ozempic 0,5 mg)'],
    });
  });

  it('quotes every matching segment', () => {
    expect(evaluateWith({ medications: ['ozempic; wegovy'] }).reasons).toEqual([
      'flagged: current GLP-1 medication (ozempic; wegovy)',
    ]);
  });

  it('ignores a medication that is not on the list', () => {
    expect(evaluateWith({ medications: ['levothyroxine 50mcg'] }).reasons).toEqual([CLEAR_LINE]);
  });
});

describe('flag conditions', () => {
  it('flags with ADR-0005’s wording, quoting the text as typed', () => {
    expect(evaluateWith({ conditions: ['schildklierkanker (2019)'] })).toMatchObject({
      outcome: 'auto_flagged',
      reasons: [
        'flagged: self-reported history of thyroid cancer / pancreatitis (schildklierkanker (2019))',
      ],
    });
  });

  it('flags on the free-text answer too', () => {
    expect(evaluateWith({ conditionsOther: ['pancreatitis 2022'] })).toMatchObject({
      outcome: 'auto_flagged',
      reasons: [
        'flagged: self-reported history of thyroid cancer / pancreatitis (pancreatitis 2022)',
      ],
    });
  });

  it('ignores a condition that is not on the list', () => {
    expect(evaluateWith({ conditions: ['hypothyreoidie'] }).reasons).toEqual([CLEAR_LINE]);
  });
});

describe('precedence (Q1 default: collect every match, then resolve)', () => {
  it('lets a flag pre-empt the BMI reject, naming the conflict', () => {
    expect(evaluateWith({ weightKg: 96.4, medications: ['ozempic'] })).toMatchObject({
      outcome: 'auto_flagged',
      reasons: [
        'rejected: BMI 24.1 below 27',
        'flagged: current GLP-1 medication (ozempic)',
        'flagged: BMI 24.1 below 27, but a flag rule also matched; a human decides',
      ],
    });
  });

  it('keeps age under 18 an absolute reject, with no resolution line', () => {
    expect(evaluateWith({ ageYears: 16, medications: ['ozempic'] })).toMatchObject({
      outcome: 'auto_rejected',
      reasons: ['rejected: age 16 at submission', 'flagged: current GLP-1 medication (ozempic)'],
    });
  });

  it('rejects on age even when the BMI also rejects', () => {
    expect(evaluateWith({ ageYears: 16, weightKg: 96.4 })).toMatchObject({
      outcome: 'auto_rejected',
      reasons: ['rejected: age 16 at submission', 'rejected: BMI 24.1 below 27'],
    });
  });

  it('rejects when nothing flags', () => {
    expect(evaluateWith({ weightKg: 96.4 }).outcome).toBe('auto_rejected');
  });

  it('lists every matched rule, in rule order', () => {
    expect(
      evaluateWith({
        weightKg: 96.4,
        medications: ['ozempic'],
        conditions: ['schildklierkanker (2019)'],
      }).reasons,
    ).toEqual([
      'rejected: BMI 24.1 below 27',
      'flagged: current GLP-1 medication (ozempic)',
      'flagged: self-reported history of thyroid cancer / pancreatitis (schildklierkanker (2019))',
      'flagged: BMI 24.1 below 27, but a flag rule also matched; a human decides',
    ]);
  });

  it('rejects when the ruleset says a flag does not pre-empt a reject', () => {
    const strict = { ...rules, precedence: { ...rules.precedence, flag_preempts_reject: false } };
    const input = { ...CLEARED, weightKg: 96.4, medications: ['ozempic'] };
    expect(evaluate(input, strict)).toMatchObject({
      outcome: 'auto_rejected',
      reasons: ['rejected: BMI 24.1 below 27', 'flagged: current GLP-1 medication (ozempic)'],
    });
  });
});

describe('a missing input (ADR-0010: it removes the clearing, nothing else)', () => {
  it('rejects when an absolute reject fired on the inputs that are present', () => {
    expect(evaluateWith({ ageYears: 16, weightKg: null })).toMatchObject({
      outcome: 'auto_rejected',
      reasons: ['rejected: age 16 at submission', 'BMI not evaluated: weight missing'],
    });
  });

  it('flags when a flag rule fired on the inputs that are present', () => {
    expect(evaluateWith({ heightCm: null, medications: ['ozempic'] })).toMatchObject({
      outcome: 'auto_flagged',
      reasons: ['BMI not evaluated: height missing', 'flagged: current GLP-1 medication (ozempic)'],
    });
  });

  it.each([
    ['the age', { ageYears: null }],
    ['the weight', { weightKg: null }],
    ['the height', { heightCm: null }],
  ])('is not evaluable, never cleared, when no rule fired and %s is missing', (_label, patch) => {
    const result = evaluateWith(patch);
    expect(result.outcome).toBe('not_evaluable');
    expect(result.reasons).not.toContain(CLEAR_LINE);
  });

  it('clears only when every rule could run', () => {
    expect(evaluateWith({}).outcome).toBe('auto_cleared');
  });
});

describe('the result', () => {
  it('carries the ruleset version that evaluated it (R-B8)', () => {
    expect(evaluateWith({}).rulesetVersion).toBe('v1');
  });

  it('carries the inputs the rules saw, BMI unrounded (R-B9)', () => {
    const result = evaluateWith({
      weightKg: 107.96,
      medications: ['Ozempic 0,5 mg'],
      conditions: ['hoge bloeddruk; schildklierkanker (2019)'],
    });
    expect(result.inputs.ageYears).toBe(40);
    expect(result.inputs.weightKg).toBe(107.96);
    expect(result.inputs.heightCm).toBe(200);
    expect(result.inputs.bmi).toBeCloseTo(26.99, 10);
    expect(result.inputs.bmi).not.toBe(27);
    expect(result.inputs.glp1).toEqual([{ term: 'ozempic', text: 'Ozempic 0,5 mg' }]);
    expect(result.inputs.flagConditions).toEqual([
      { term: 'schildklierkanker', text: 'schildklierkanker (2019)' },
    ]);
    expect(result.inputs.weightRelated).toEqual([
      { term: 'hoge bloeddruk', text: 'hoge bloeddruk' },
    ]);
  });

  it('reports a null BMI when a metric is missing', () => {
    expect(evaluateWith({ weightKg: null }).inputs.bmi).toBeNull();
  });
});

describe('determinism (R-B5, R-B10)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives the same result for the same input, whatever the clock says', () => {
    const input = { ...CLEARED, weightKg: 96.4, medications: ['ozempic'] };
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2023-01-01T00:00:00Z'));
    const first = evaluate(input, rules);
    vi.setSystemTime(new Date('2031-06-30T23:59:59Z'));
    const second = evaluate(input, rules);
    expect(second).toEqual(first);
    expect(evaluate(input, rules)).toEqual(first);
  });
});

describe('impossible inputs throw rather than evaluate (CLAUDE.md §2)', () => {
  it.each([
    ['a zero height', { heightCm: 0 }],
    ['a negative height', { heightCm: -170 }],
    ['a zero weight', { weightKg: 0 }],
    ['a negative weight', { weightKg: -80 }],
    ['a non-finite weight', { weightKg: Number.NaN }],
    ['an infinite height', { heightCm: Number.POSITIVE_INFINITY }],
  ])('throws on %s', (_label, patch) => {
    expect(() => evaluateWith(patch)).toThrow(/positive finite number/);
  });

  it.each([
    ['a negative age', { ageYears: -1 }],
    ['a fractional age', { ageYears: 17.5 }],
    ['a non-finite age', { ageYears: Number.NaN }],
  ])('throws on %s', (_label, patch) => {
    expect(() => evaluateWith(patch)).toThrow(/whole number of years/);
  });
});
