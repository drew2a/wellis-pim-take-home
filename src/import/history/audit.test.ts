// The history audit over the whole export: the shadow evaluations ADR-0005 requires for every
// legacy intake, and the three classes of item it says are the only ones worth queueing.
import { describe, expect, it } from 'vitest';

import type { MatchedRule } from '@/eligibility/types';
import { loadRules } from '@/rules/load';

import { mapIntake } from '../mapper/intake';
import { mapPatient } from '../mapper/patient';
import type { Ids } from '../review/mapping-items';
import { parseCsv } from '../source/csv';
import { readExportFiles } from '../source/files';
import { INTAKES_HEADER, PATIENTS_HEADER, byHeader } from '../source/layout';
import { clinicalHistoryItems, evaluateHistory } from './audit';

const rules = loadRules();
const context = { asOf: '2026-09-08', rules };
const files = readExportFiles('legacy_export');
const patients = parseCsv(files['patients.csv'].bytes, PATIENTS_HEADER).map((r) =>
  mapPatient(byHeader(PATIENTS_HEADER, r.fields), context),
);
const intakes = parseCsv(files['intakes.csv'].bytes, INTAKES_HEADER).map((r) =>
  mapIntake(byHeader(INTAKES_HEADER, r.fields), context),
);
const ids: Ids = {
  patients: new Map(patients.map((p) => [p.legacyId, `uuid-${p.legacyId}`])),
  intakes: new Map(intakes.map((i) => [i.intakeId, `uuid-${i.intakeId}`])),
};

const evaluations = evaluateHistory(intakes, patients, rules);
const items = clinicalHistoryItems(evaluations, ids, rules);
const hits = (rule: MatchedRule): number =>
  evaluations.filter((e) => e.result.matched.includes(rule)).length;

describe('the shadow evaluation of every legacy intake', () => {
  it('evaluates every intake exactly once, orphans included', () => {
    expect(evaluations).toHaveLength(2917);
    expect(new Set(evaluations.map((e) => e.intakeId)).size).toBe(2917);
  });

  it('records not_evaluable rather than clearing an intake it could not judge', () => {
    const notEvaluable = evaluations.filter((e) => e.result.outcome === 'not_evaluable');

    expect(notEvaluable.length).toBeGreaterThan(0);
    // Every one of them is missing an input the rules needed, and matched no rule.
    for (const evaluation of notEvaluable) {
      const { ageYears, bmi } = evaluation.result.inputs;
      expect(ageYears === null || bmi === null).toBe(true);
      expect(evaluation.result.matched).toEqual([]);
    }
  });

  it('carries the ruleset version and the inputs the rules saw', () => {
    expect(new Set(evaluations.map((e) => e.result.rulesetVersion))).toEqual(new Set(['v1']));
    const withBmi = evaluations.find((e) => e.result.inputs.bmi !== null);
    const inputs = withBmi?.result.inputs;
    expect(typeof inputs?.ageYears).toBe('number');
    expect(typeof inputs?.weightKg).toBe('number');
    expect(typeof inputs?.heightCm).toBe('number');
  });

  // The report figures of ADR-0005: disagreements a doctor already saw, counted and never queued.
  it('reproduces the per-rule hit counts of ADR-0005', () => {
    expect(hits('bmi_below_minimum')).toBe(191);
    expect(hits('bmi_band_without_condition')).toBe(283);
    expect(hits('glp1_medication')).toBe(42);
    expect(hits('flag_condition')).toBe(15);
    expect(hits('age_below_minimum')).toBe(70);
  });
});

describe('the items the history audit raises', () => {
  const byRule = (rule: string): typeof items =>
    items.filter((item) => item.dedupeKey.includes(rule));

  it('queues the free-text findings and the minors the legacy process let through', () => {
    expect(byRule('HISTORY_GLP1_MEDICATION')).toHaveLength(42);
    expect(byRule('HISTORY_FLAG_CONDITION')).toHaveLength(15);
    expect(byRule('HISTORY_MINOR_NOT_REJECTED')).toHaveLength(58);
    expect(items).toHaveLength(42 + 15 + 58);
  });

  it('leaves the 12 rejected minors as a figure: the legacy process saw the age and said no', () => {
    const minors = evaluations.filter(
      (e) => e.result.inputs.ageYears !== null && e.result.inputs.ageYears < 18,
    );
    const rejected = minors.filter((e) => e.legacyOutcome === 'rejected');

    expect(minors).toHaveLength(70);
    expect(rejected).toHaveLength(12);
    expect(byRule('HISTORY_MINOR_NOT_REJECTED')).toHaveLength(70 - 12);
  });

  it('queues no BMI disagreement: the doctor who approved the intake saw the BMI', () => {
    expect(items.every((item) => !item.dedupeKey.includes('BMI'))).toBe(true);
    expect(new Set(items.map((item) => `${item.type}/${item.scope}`))).toEqual(
      new Set(['clinical_history/row']),
    );
  });

  it("quotes the engine's own reason string, the wording ADR-0005 fixed", () => {
    const glp1 = byRule('HISTORY_GLP1_MEDICATION')[0];
    const condition = byRule('HISTORY_FLAG_CONDITION')[0];
    const minor = byRule('HISTORY_MINOR_NOT_REJECTED')[0];

    expect(glp1?.reason).toMatch(/^flagged: current GLP-1 medication \(.+\)$/u);
    expect(condition?.reason).toMatch(
      /^flagged: self-reported history of thyroid cancer \/ pancreatitis \(.+\)$/u,
    );
    expect(minor?.reason).toMatch(/^rejected: age \d+ at submission$/u);
  });

  it('never proposes a resolution and never changes a legacy outcome', () => {
    expect(items.every((item) => item.proposedResolution === null)).toBe(true);
    for (const item of items) {
      const payload = item.payload as { legacy_outcome: string; shadow_outcome: string };
      expect(payload.legacy_outcome).toBeDefined();
      expect(payload.shadow_outcome).toBeDefined();
    }
  });

  it('raises one item per intake and rule, so a re-run finds its own', () => {
    expect(new Set(items.map((item) => item.dedupeKey)).size).toBe(items.length);
  });
});
