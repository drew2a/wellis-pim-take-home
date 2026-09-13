// The coverage tests ADR-0015 item 2 promises: the form's checklists and the ruleset's term lists
// say the same thing, in both directions. A term added to `rules/v1.json` without an option would
// be a rule nobody can answer; an option that is not a term would be a checkbox the engine ignores.
import { describe, expect, it } from 'vitest';

import { loadRules } from '@/rules/load';

import {
  CONDITION_OPTIONS,
  conditionTermsOf,
  coveredTerms,
  GLP1_OPTIONS,
  type ChecklistOption,
} from './options';

const rules = loadRules();

function expectCovers(options: readonly ChecklistOption[], terms: readonly string[]): void {
  const covered = coveredTerms(options);
  expect([...terms].filter((term) => !covered.has(term))).toEqual([]);
  expect([...covered].filter((term) => !terms.includes(term))).toEqual([]);
}

describe('checklist options', () => {
  it('offers every GLP-1 term of the ruleset and nothing else', () => {
    expectCovers(GLP1_OPTIONS, rules.glp1_terms);
  });

  it('offers every condition term of both ruleset lists and nothing else', () => {
    expectCovers(CONDITION_OPTIONS, conditionTermsOf(rules));
  });

  it.each([
    ['GLP-1', GLP1_OPTIONS],
    ['condition', CONDITION_OPTIONS],
  ])('submits a %s value that is itself a ruleset term', (_name, options) => {
    for (const option of options) {
      expect(option.terms).toContain(option.value);
    }
  });

  it.each([
    ['GLP-1', GLP1_OPTIONS],
    ['condition', CONDITION_OPTIONS],
  ])('gives each %s term to exactly one option', (_name, options) => {
    const terms = options.flatMap((option) => option.terms);
    expect(terms).toHaveLength(new Set(terms).size);
  });
});
