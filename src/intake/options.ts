// The checklists the intake form shows (ADR-0015 item 2). An option's `value` is a term from
// `rules/v1.json` and its `terms` are the ruleset synonyms it stands for, so the Dutch and English
// names of one condition are one checkbox rather than two. Labels are presentation and nothing
// else: the engine never sees them, it sees the value, which is a term it already matches.
//
// The map is checked against the ruleset in both directions by `options.test.ts` — no option value
// that is not a term, no ruleset term that no option covers — so a term added to a list cannot
// silently disappear from the form.
import type { Rules } from '@/rules/schema';

export interface ChecklistOption {
  /** The ruleset term submitted when the option is ticked. One of `terms`. */
  readonly value: string;
  readonly label: string;
  /** Every ruleset term this option stands for, the value included. */
  readonly terms: readonly string[];
}

/** Grouped by molecule: a patient knows the brand, the ruleset knows both. */
export const GLP1_OPTIONS: readonly ChecklistOption[] = [
  {
    value: 'semaglutide',
    label: 'Ozempic, Wegovy or Rybelsus (semaglutide)',
    terms: ['semaglutide', 'ozempic', 'wegovy', 'rybelsus'],
  },
  {
    value: 'tirzepatide',
    label: 'Mounjaro or Zepbound (tirzepatide)',
    terms: ['tirzepatide', 'mounjaro', 'zepbound'],
  },
  {
    value: 'liraglutide',
    label: 'Saxenda or Victoza (liraglutide)',
    terms: ['liraglutide', 'saxenda', 'victoza'],
  },
  {
    value: 'dulaglutide',
    label: 'Trulicity (dulaglutide)',
    terms: ['dulaglutide', 'trulicity'],
  },
  {
    value: 'exenatide',
    label: 'Byetta or Bydureon (exenatide)',
    terms: ['exenatide', 'byetta', 'bydureon'],
  },
  {
    value: 'lixisenatide',
    label: 'Lixisenatide',
    terms: ['lixisenatide'],
  },
];

/**
 * Both condition lists in one checklist, in the order a patient reads them rather than grouped by
 * what they do to the outcome: a weight-related condition can suppress the band flag and a flag
 * condition raises one, but a patient answering "do you have any of these" must not be able to
 * infer which answer helps them.
 */
export const CONDITION_OPTIONS: readonly ChecklistOption[] = [
  {
    value: 'hoge bloeddruk',
    label: 'Hoge bloeddruk (hypertensie)',
    terms: ['hoge bloeddruk', 'hypertensie'],
  },
  { value: 'diabetes type 2', label: 'Diabetes type 2', terms: ['diabetes type 2'] },
  { value: 'prediabetes', label: 'Prediabetes', terms: ['prediabetes'] },
  { value: 'hoog cholesterol', label: 'Hoog cholesterol', terms: ['hoog cholesterol'] },
  { value: 'slaapapneu', label: 'Slaapapneu', terms: ['slaapapneu'] },
  { value: 'pcos', label: 'PCOS', terms: ['pcos'] },
  {
    value: 'schildklierkanker',
    label: 'Schildklierkanker (thyroid cancer)',
    terms: ['schildklierkanker', 'schildkliercarcinoom', 'thyroid cancer', 'medullary thyroid'],
  },
  {
    value: 'pancreatitis',
    label: 'Alvleesklierontsteking (pancreatitis)',
    terms: ['pancreatitis', 'alvleesklierontsteking'],
  },
];

export const optionValues = (options: readonly ChecklistOption[]): string[] =>
  options.map((option) => option.value);

/** The ruleset terms a checklist claims to cover, for the coverage test. */
export const coveredTerms = (options: readonly ChecklistOption[]): Set<string> =>
  new Set(options.flatMap((option) => option.terms));

/** The two condition lists as one set: the checklist covers both (ADR-0015 item 2). */
export const conditionTermsOf = (rules: Rules): string[] => [
  ...rules.weight_related_condition_terms,
  ...rules.flag_condition_terms,
];
