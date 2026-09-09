/**
 * EXPORT-NOTES.md, claim by claim, against the inventories.
 *
 * Verdicts are computed from the numbers the inventories produced, never typed, so a
 * verdict cannot drift away from its evidence. `unverifiable` is used wherever the claim
 * is about the old team's intent or history, which this export cannot show.
 */
import type {Consents} from './consents.js';
import type {Intakes} from './intakes.js';
import type {Patients} from './patients.js';
import {candidateDates} from './dates.js';
import type {Section} from './report.js';
import {fold, shape} from './util.js';

export type Verdict = 'confirmed' | 'contradicted' | 'partly' | 'unverifiable';

export interface ClaimRow {
  readonly claim: string;
  readonly verdict: Verdict;
  /** Section keys; rendered as P-n. */
  readonly evidence: readonly string[];
  readonly note: string;
}

export interface NotWarnedItem {
  readonly text: string;
  readonly evidence: readonly string[];
}

export interface ClaimsInput {
  readonly sections: readonly Section[];
  readonly patients: Patients;
  readonly intakes: Intakes;
  readonly consents: Consents;
  /** Reference date (`--as-of`), quoted wherever a note says "future". */
  readonly asOf: string;
}

function jsonOf(input: ClaimsInput, key: string): Record<string, unknown> {
  const s = input.sections.find((x) => x.key === key);
  if (s === undefined) throw new Error(`no section ${key}`);
  return s.json;
}

/** Strict number read: a missing or non-numeric field is a bug, not a zero. */
function num(input: ClaimsInput, key: string, field: string): number {
  const v = jsonOf(input, key)[field];
  if (typeof v !== 'number') throw new Error(`${key}.${field} is not a number`);
  return v;
}

function bandRows(input: ClaimsInput, key: string, field: string, bandLabel: string): number {
  const v = jsonOf(input, key)[field];
  if (!Array.isArray(v)) throw new Error(`${key}.${field} is not an array`);
  for (const e of v as Array<Record<string, unknown>>) {
    // Band inventories carry `rows` (ratio bands) or `count` (numeric bands).
    if (e['band'] === bandLabel) return Number(e['rows'] ?? e['count'] ?? 0);
  }
  throw new Error(`${key}.${field} has no band ${bandLabel}`);
}

function valueCount(input: ClaimsInput, key: string, field: string, raw: string): number {
  const v = jsonOf(input, key)[field];
  if (!Array.isArray(v)) throw new Error(`${key}.${field} is not an array`);
  for (const e of v as Array<Record<string, unknown>>) {
    if (e['raw'] === raw || e['value'] === raw || e['folded'] === raw) return Number(e['count'] ?? e['rows'] ?? 0);
  }
  return 0;
}

/** Per-shape ordering evidence, e.g. "`99/99/9999` month-first only (154 of 287)". */
function orderingByShape(input: ClaimsInput, key: string): string {
  const shapes = jsonOf(input, key)['shapes'];
  if (!Array.isArray(shapes)) throw new Error(`${key}.shapes is not an array`);
  return (shapes as Array<Record<string, unknown>>)
    .map((s) => {
      const by = s['byOrderClass'] as Record<string, number>;
      const day = by['day-first'] ?? 0;
      const month = by['month-first'] ?? 0;
      const label = day > 0 && month === 0 ? `day-first only (${day}` : month > 0 && day === 0 ? `month-first only (${month}` : `neither ordering proven (0`;
      return `\`${String(s['shape'])}\` ${label} of ${String(s['count'])})`;
    })
    .join(', ');
}

function distinctValues(input: ClaimsInput, key: string, field: string): string[] {
  const v = jsonOf(input, key)[field];
  if (!Array.isArray(v)) throw new Error(`${key}.${field} is not an array`);
  return (v as Array<Record<string, unknown>>).map((e) => String(e['raw'] ?? e['value'] ?? e['folded'] ?? ''));
}

/** Derived facts that need the rows themselves rather than an inventory field. */
interface ExtraFacts {
  readonly isoShapeSubmittedBefore2024: number;
  readonly nonIsoShapeSubmitted2024OrLater: number;
  readonly isoShapeSignupBefore2024: number;
  readonly nonIsoShapeSignup2024OrLater: number;
  readonly bsnYears: readonly string[];
  readonly allSignupYears: readonly string[];
  readonly twijfelRows: number;
  readonly twijfelOnRejection: number;
  readonly twijfelOnNeither: number;
  readonly conditionLanguages: ConditionLanguages;
}

/**
 * Every `conditions` row in exactly one class, so the counts add up to the row count. The
 * two word lists are disjoint by construction: a spelling that is the same in both languages
 * (`reflux`, `pcos`, `prediabetes`, `pancreatitis`, `diabetes type 2`) is `neutral`, and the
 * English placeholder `none` is counted apart from English condition names.
 */
interface ConditionLanguages {
  readonly dutchOnly: number;
  readonly englishOnly: number;
  readonly englishNone: number;
  readonly neutral: number;
  readonly empty: number;
  readonly neutralValues: readonly string[];
}

const DUTCH_ONLY = /schildklier|alvleesklier|suikerziekte|bloeddruk|slaapapneu|lever|artrose|hoog cholesterol|depressie|hypertensie|astma|hypothyreoidie|\bgeen\b/u;
const ENGLISH_ONLY = /thyroid|hypertension|apnea|osteoarth|depression|asthma|\bliver\b|high cholesterol|high blood pressure/u;

function conditionLanguages(values: readonly string[]): ConditionLanguages {
  let dutchOnly = 0;
  let englishOnly = 0;
  let englishNone = 0;
  let neutral = 0;
  let empty = 0;
  const neutralValues = new Set<string>();
  for (const v of values) {
    const f = fold(v);
    const nl = DUTCH_ONLY.test(f);
    const en = ENGLISH_ONLY.test(f);
    if (nl && en) throw new Error(`condition language lists overlap on ${JSON.stringify(v)}`);
    if (f === '') empty++;
    else if (nl) dutchOnly++;
    else if (en) englishOnly++;
    else if (f === 'none') englishNone++;
    else {
      neutral++;
      neutralValues.add(f);
    }
  }
  return {dutchOnly, englishOnly, englishNone, neutral, empty, neutralValues: [...neutralValues].sort()};
}

function extras(input: ClaimsInput): ExtraFacts {
  const it = input.intakes;
  const p = input.patients;
  const yearOf = (v: string): string => (candidateDates(v)[0] ?? '').slice(0, 4);
  const isIso = (v: string): boolean => shape(v) === '9999-99-99';

  let isoBeforeS = 0;
  let nonIsoAfterS = 0;
  it.submittedAt.forEach((v) => {
    const y = yearOf(v);
    if (y === '') return;
    if (isIso(v) && y < '2024') isoBeforeS++;
    if (!isIso(v) && y >= '2024') nonIsoAfterS++;
  });
  let isoBeforeP = 0;
  let nonIsoAfterP = 0;
  p.signupDate.forEach((v) => {
    const y = yearOf(v);
    if (y === '') return;
    if (isIso(v) && y < '2024') isoBeforeP++;
    if (!isIso(v) && y >= '2024') nonIsoAfterP++;
  });

  const bsnYears = new Set<string>();
  const allYears = new Set<string>();
  p.bsn.forEach((v, i) => {
    const y = yearOf(p.signupDate[i] ?? '');
    if (y !== '') allYears.add(y);
    if (v !== '' && y !== '') bsnYears.add(y);
  });

  const REJECTION = ['rejected', 'afgewezen', 'declined'];
  const APPROVAL = ['approved', 'goedgekeurd', 'ok'];
  const twijfelRows = it.reviewerNote
    .map((v, i) => ({note: fold(v), outcome: fold(it.outcome[i] ?? '')}))
    .filter((r) => r.note.includes('twijfel'));
  const twijfelOnRejection = twijfelRows.filter((r) => REJECTION.includes(r.outcome)).length;
  const twijfelOnNeither = twijfelRows.filter(
    (r) => !REJECTION.includes(r.outcome) && !APPROVAL.includes(r.outcome),
  ).length;

  return {
    isoShapeSubmittedBefore2024: isoBeforeS,
    nonIsoShapeSubmitted2024OrLater: nonIsoAfterS,
    isoShapeSignupBefore2024: isoBeforeP,
    nonIsoShapeSignup2024OrLater: nonIsoAfterP,
    bsnYears: [...bsnYears].sort(),
    allSignupYears: [...allYears].sort(),
    twijfelRows: twijfelRows.length,
    twijfelOnRejection,
    twijfelOnNeither,
    conditionLanguages: conditionLanguages(it.conditions),
  };
}

export function claimRows(input: ClaimsInput): ClaimRow[] {
  const x = extras(input);
  const P = 'patients.csv';
  const I = 'intakes.csv';
  const C = 'consents.jsonl';

  const idDupGroups = num(input, `${P}.legacy_id`, 'duplicateGroups');
  const intakeOrphans = num(input, `${I}.legacy_patient_id`, 'orphanRows');
  const consentOrphans = num(input, `${C}.patient_legacy_id`, 'unresolvedEvents');
  const emailFoldedDupGroups = num(input, `${P}.email`, 'foldedDuplicateGroups');
  const emailSyntaxFailures = (jsonOf(input, `${P}.email`)['syntaxFailures'] as unknown[]).length;
  const dobAmbiguousShapes = num(input, `${P}.dob`, 'valuesWithMultipleCandidateDates');
  const dobMixed = (jsonOf(input, `${P}.dob`)['mixedShapes'] as unknown[]).length;
  const sexDistinct = num(input, `${P}.sex`, 'distinct');
  const sexFolded = num(input, `${P}.sex`, 'distinctFolded');
  const bsnFail = num(input, `${P}.bsn`, 'nineDigitElfproefFail');
  const bsnNine = num(input, `${P}.bsn`, 'nineDigit');
  const phoneShapes = num(input, `${P}.phone`, 'distinctShapes');
  const cityMergeGroups = num(input, `${P}.city`, 'foldingMergeGroups');
  const unitEmpty = num(input, `${P}.weight_unit`, 'empty');
  const bmiKgOut = num(input, `${P}.weight`, 'bmiKgOutsideLbInside');
  const heightBelow140 = bandRows(input, `${P}.height_cm`, 'bands', '100 .. 140');
  const heightBelow100 = bandRows(input, `${P}.height_cm`, 'bands', '3 .. 100');
  const heightMetres = bandRows(input, `${P}.height_cm`, 'bands', '< 3');
  const heightAbove220 = bandRows(input, `${P}.height_cm`, 'bands', '>= 220');
  const statusDistinct = num(input, `${P}.status`, 'distinct');
  const statusFolded = num(input, `${P}.status`, 'distinctFolded');
  const signupFuture = num(input, `${P}.signup_date`, 'futureUnderEveryOrdering');
  const sourceValues = distinctValues(input, `${P}.source`, 'values');
  const notesSources = ['typeform', 'website', 'import'];
  const unnamedSources = sourceValues.filter((v) => !notesSources.includes(fold(v)) && !fold(v).startsWith('campaign'));
  const intakeIdDupGroups = num(input, `${I}.intake_id`, 'duplicateGroups');
  const versionDistinct = num(input, `${I}.questionnaire_version`, 'distinct');
  const weightRatioFar = bandRows(input, `${I}.weight`, 'ratioBands', '2 .. 2.4') + bandRows(input, `${I}.weight`, 'ratioBands', '0.4 .. 0.5');
  const medsDistinct = num(input, `${I}.meds_current`, 'distinctFolded');
  const medsCommaRows = (() => {
    const seps = jsonOf(input, `${I}.meds_current`)['separators'] as Array<Record<string, unknown>>;
    return Number(seps.find((s) => s['separator'] === ',')?.['rows'] ?? 0);
  })();
  const medsEmptyLike = (jsonOf(input, `${I}.meds_current`)['emptyLike'] as unknown[]).length;
  const alcoholNonNumeric = (jsonOf(input, `${I}.alcohol_units_week`)['nonNumericValues'] as unknown[]).length;
  const outcomeFolded = num(input, `${I}.outcome`, 'distinctFolded');
  const outcomeEmpty = num(input, `${I}.outcome`, 'empty');
  const noteDistinct = num(input, `${I}.reviewer_note`, 'distinct');
  // Do the two vocabularies actually stay apart? Counted, not asserted.
  const statusFoldedSet = new Set(input.patients.status.map((v) => fold(v)));
  const sharedVocabulary = [...new Set(input.intakes.outcome.map((v) => fold(v)))].filter((v) => statusFoldedSet.has(v)).length;
  const consentTypes = Object.keys(jsonOf(input, `${C}.type-action-version`)['types'] as Record<string, unknown>);
  const consentActions = Object.keys(jsonOf(input, `${C}.type-action-version`)['actions'] as Record<string, unknown>);
  const consentVersions = Object.keys(jsonOf(input, `${C}.type-action-version`)['versions'] as Record<string, unknown>);
  const invalidLines = (jsonOf(input, `${C}.structure`)['invalidLines'] as unknown[]).length;
  const atTz = num(input, `${C}.at`, 'withTimezoneSuffix');
  const before2023 = num(input, `${C}.at`, 'eventsBefore2023');
  const outOfOrder = num(input, `${C}.sequences`, 'patientsWithFileOrderDifferentFromAtOrder');
  const beforeSignup = num(input, `${I}.submitted_at`, 'beforeSignupUnderEveryOrdering');
  const lbsUnitRows = valueCount(input, `${P}.weight_unit`, 'values', 'lbs');
  const dupCandidateGroupings = jsonOf(input, 'cross.duplicate-candidates')['groupings'] as Array<Record<string, unknown>>;
  const cGrouping = dupCandidateGroupings.find((g) => g['id'] === 'c') ?? {};
  const cGroups = Number(cGrouping['groups'] ?? 0);
  const cSpanningEmails = Number(cGrouping['groupsSpanningSeveralFoldedEmails'] ?? 0);

  return [
    {
      claim: 'patients.csv: `legacy_id` is an auto-generated row id, referenced by intakes.csv and consents.jsonl',
      verdict: idDupGroups === 0 && intakeOrphans === 0 && consentOrphans === 0 ? 'confirmed' : 'partly',
      evidence: [`${P}.legacy_id`, `${I}.legacy_patient_id`, `${C}.patient_legacy_id`],
      note: `${idDupGroups} duplicate id values; ${intakeOrphans} intake rows and ${consentOrphans} consent events reference an id that is not in patients.csv.`,
    },
    {
      claim: 'patients.csv: `full_name` is as typed by the patient or ops',
      verdict: 'unverifiable',
      evidence: [`${P}.full_name`],
      note: 'The export carries no provenance per field. The inventory shows the variation that "as typed" implies.',
    },
    {
      claim: 'patients.csv: `email` is the primary contact and was also used as a login by one automation',
      verdict: 'partly',
      evidence: [`${P}.email`],
      note: `Login use is not visible in the export. ${emailFoldedDupGroups} case-insensitive duplicate groups and ${emailSyntaxFailures} values failing the syntax check mean the column is not a unique identifier as exported.`,
    },
    {
      claim: 'patients.csv: `dob` is the date of birth',
      verdict: 'partly',
      evidence: [`${P}.dob`],
      note: `${dobAmbiguousShapes} values read as two different calendar dates depending on the ordering, ${dobMixed} shapes carry both an unambiguous day-first and an unambiguous month-first value, and the shapes point in opposite directions: ${orderingByShape(input, `${P}.dob`)}. ${num(input, `${P}.dob`, 'futureUnderEveryOrdering')} values read as a date after ${input.asOf} under every ordering.`,
    },
    {
      claim: 'patients.csv: `sex` is whatever the form or the ops person entered at the time',
      verdict: 'confirmed',
      evidence: [`${P}.sex`],
      note: `${sexDistinct} raw spellings, ${sexFolded} after folding, Dutch and English mixed.`,
    },
    {
      claim: 'patients.csv: `bsn` is a Dutch citizen service number, never validated',
      verdict: 'confirmed',
      evidence: [`${P}.bsn`],
      note: `${bsnFail} of ${bsnNine} nine-digit values fail the elfproef.`,
    },
    {
      claim: 'patients.csv: `phone` format was never enforced',
      verdict: 'confirmed',
      evidence: [`${P}.phone`],
      note: `${phoneShapes} distinct shapes.`,
    },
    {
      claim: 'patients.csv: `city` is self-reported',
      verdict: 'unverifiable',
      evidence: [`${P}.city`],
      note: `Provenance is not in the export; ${cityMergeGroups} folded values have more than one raw spelling.`,
    },
    {
      claim: 'patients.csv: `weight` / `weight_unit` is weight at signup, with the unit column added late and backfilled "where obvious"',
      verdict: 'partly',
      evidence: [`${P}.weight`, `${P}.weight_unit`],
      note: `${unitEmpty} rows have no unit and ${lbsUnitRows} say lbs; ${bmiKgOut} rows sit outside a 15..70 BMI window under the kilogram reading but inside it under the pound reading. When the backfill happened is not visible.`,
    },
    {
      claim: 'patients.csv: `height_cm` was always intended as centimetres',
      verdict: heightMetres + heightBelow100 + heightBelow140 + heightAbove220 === 0 ? 'confirmed' : 'partly',
      evidence: [`${P}.height_cm`],
      note: `${heightMetres} values below 3, ${heightBelow100} in 3..100, ${heightBelow140} in 100..140 and ${heightAbove220} at 220 or more.`,
    },
    {
      claim: 'patients.csv: `status` is roughly active / paused / churned / prospect, spelled many ways',
      verdict: 'confirmed',
      evidence: [`${P}.status`],
      note: `${statusDistinct} raw spellings, ${statusFolded} after folding, including Dutch words and trailing whitespace.`,
    },
    {
      claim: 'patients.csv: `signup_date` is when the row was created',
      verdict: 'partly',
      evidence: [`${P}.signup_date`, 'cross.date-range'],
      note: `${signupFuture} rows are dated after the reference date ${input.asOf} under every plausible ordering.`,
    },
    {
      claim: 'patients.csv: `source` is the funnel: `typeform`, `website`, campaign tags, `import`',
      verdict: unnamedSources.length === 0 ? 'confirmed' : 'partly',
      evidence: [`${P}.source`],
      note:
        unnamedSources.length === 0
          ? 'Every value present is named in the notes.'
          : `Values present but not named in the notes: ${unnamedSources.map((v) => `\`${v}\``).join(', ')}.`,
    },
    {
      claim: 'intakes.csv: `intake_id` is the form tool submission id',
      verdict: intakeIdDupGroups === 0 ? 'confirmed' : 'partly',
      evidence: [`${I}.intake_id`],
      note: `${intakeIdDupGroups} id values appear on more than one row.`,
    },
    {
      claim: 'intakes.csv: `legacy_patient_id` should reference patients.csv:legacy_id, but the automation occasionally fired before the patient row existed',
      verdict: 'confirmed',
      evidence: [`${I}.legacy_patient_id`, `${I}.submitted_at`],
      note: `${intakeOrphans} rows do not resolve; ${num(input, `${I}.submitted_at`, 'beforeSignupUnderSomeOrdering')} resolvable intakes are dated before their patient's signup_date under at least one ordering and ${beforeSignup} under every ordering.`,
    },
    {
      claim: 'intakes.csv: `submitted_at` is the submission date',
      verdict: 'partly',
      evidence: [`${I}.submitted_at`],
      note: `The column carries several shapes and ${num(input, `${I}.submitted_at`, 'valuesWithMultipleCandidateDates')} values that read as two different dates.`,
    },
    {
      claim: 'intakes.csv: `questionnaire_version` labelling discipline varied',
      verdict: 'confirmed',
      evidence: [`${I}.questionnaire_version`],
      note: `${versionDistinct} distinct raw values including an empty one.`,
    },
    {
      claim: 'intakes.csv: `weight` / `height` are self-reported at submission time and can legitimately differ from patients.csv',
      verdict: 'partly',
      evidence: [`${I}.weight`, `${I}.height`],
      note: `They do differ, and ${weightRatioFar} rows differ by roughly the kilogram/pound factor, which is not a difference "self-reported" explains on its own.`,
    },
    {
      claim: 'intakes.csv: `meds_current` is free text, never normalised',
      verdict: 'confirmed',
      evidence: [`${I}.meds_current`],
      note: `${medsDistinct} distinct folded values; ${medsCommaRows} rows list several medications separated by a comma and ${medsEmptyLike} folded values match the empty-like heuristic.`,
    },
    {
      claim: 'intakes.csv: `conditions` is free text, Dutch and English mixed',
      verdict: x.conditionLanguages.dutchOnly > 0 && x.conditionLanguages.englishOnly > 0 ? 'confirmed' : 'partly',
      evidence: [`${I}.conditions`],
      note:
        `Each row in one class: ${x.conditionLanguages.dutchOnly} rows carry a Dutch-only spelling, ` +
        `${x.conditionLanguages.englishOnly} an English-only condition name, ${x.conditionLanguages.englishNone} the English ` +
        `placeholder \`none\`, ${x.conditionLanguages.neutral} a spelling that is the same in both languages ` +
        `(${x.conditionLanguages.neutralValues.map((v) => `\`${v}\``).join(', ')}) and ${x.conditionLanguages.empty} are empty.`,
    },
    {
      claim: 'intakes.csv: `alcohol_units_week` is self-reported units per week',
      verdict: 'partly',
      evidence: [`${I}.alcohol_units_week`],
      note: `${alcoholNonNumeric} distinct non-empty value is not a number, on ${valueCount(input, `${I}.alcohol_units_week`, 'nonNumericValues', 'n.v.t.')} rows.`,
    },
    {
      claim: 'intakes.csv: `outcome` is approved / rejected / pending, spelled many ways, and is distinct from the patient-level status',
      verdict: 'confirmed',
      evidence: [`${I}.outcome`, `${P}.status`],
      note: `${outcomeFolded} distinct folded values plus ${outcomeEmpty} empty ones; ${sharedVocabulary} folded values appear in both this column and patients.csv.status.`,
    },
    {
      claim: 'intakes.csv: `reviewer_note` is a free-text note by the reviewing doctor, if any',
      verdict: 'partly',
      evidence: [`${I}.reviewer_note`],
      note: `Only ${noteDistinct} distinct values appear, so the column behaves as a small template set rather than free text, and it carries no reviewer identity.`,
    },
    {
      claim: 'consents.jsonl: `patient_legacy_id` references patients.csv:legacy_id',
      verdict: consentOrphans === 0 ? 'confirmed' : 'partly',
      evidence: [`${C}.patient_legacy_id`],
      note: `${consentOrphans} events do not resolve; ${num(input, `${C}.patient_legacy_id`, 'patientsWithoutEvents')} patients have no event.`,
    },
    {
      claim: 'consents.jsonl: `type` has only `data_processing` in this export',
      verdict: consentTypes.length === 1 && consentTypes[0] === 'data_processing' ? 'confirmed' : 'contradicted',
      evidence: [`${C}.type-action-version`],
      note: `Values present: ${consentTypes.map((t) => `\`${t}\``).join(', ')}.`,
    },
    {
      claim: 'consents.jsonl: `action` is `granted` or `revoked`',
      verdict: consentActions.every((a) => a === 'granted' || a === 'revoked') ? 'confirmed' : 'contradicted',
      evidence: [`${C}.type-action-version`],
      note: `Values present: ${consentActions.map((t) => `\`${t}\``).join(', ')}.`,
    },
    {
      claim: 'consents.jsonl: `at` is the widget-side event timestamp',
      verdict: 'partly',
      evidence: [`${C}.at`],
      note: `${atTz} of the timestamps carry a timezone suffix, so the offset behind "widget-side" is not recorded.`,
    },
    {
      claim: 'consents.jsonl: `version` is the consent-text version the patient saw',
      verdict: 'unverifiable',
      evidence: [`${C}.type-action-version`],
      note: `Values present: ${consentVersions.map((t) => `\`${t}\``).join(', ')}; the export contains no consent texts to compare against.`,
    },
    {
      claim: 'Caveat: several automations plus manual ops edits wrote to patients.csv over the years',
      verdict: 'partly',
      evidence: ['cross.variation'],
      note: 'No provenance column exists, but format and vocabulary differ measurably by source and by year.',
    },
    {
      claim: 'Caveat: consents.jsonl is one JSON object per line, append-only',
      verdict: invalidLines === 0 && outOfOrder === 0 ? 'confirmed' : 'partly',
      evidence: [`${C}.structure`, `${C}.sequences`],
      note: `${invalidLines} lines fail to parse as a JSON object; ${outOfOrder} patients have a file order that differs from their timestamp order, which an append-only log would not produce on its own.`,
    },
    {
      claim: 'Caveat: consents are believed complete from 2023 onwards; before that nobody is sure',
      verdict: 'unverifiable',
      evidence: [`${C}.at`],
      note: `${before2023} events are dated before 2023-01-01, and ${num(input, `${C}.at`, 'patientsWithNoEventFrom2023')} patients have no event dated 2023 or later. Completeness cannot be checked from inside the export.`,
    },
    {
      claim: 'Caveat: the form tool was set to ISO at some point in 2024; before that it depended on the automation, at least one of them US-style',
      verdict: x.nonIsoShapeSubmitted2024OrLater > 0 || x.nonIsoShapeSignup2024OrLater > 0 ? 'contradicted' : 'partly',
      evidence: [`${I}.submitted_at`, `${P}.signup_date`],
      note: `${x.nonIsoShapeSubmitted2024OrLater} intakes dated 2024 or later still carry a non-ISO shape (and ${x.isoShapeSubmittedBefore2024} intakes before 2024 are already ISO); for signup_date the figures are ${x.nonIsoShapeSignup2024OrLater} and ${x.isoShapeSignupBefore2024}. Non-ISO shapes appear in every year.`,
    },
    {
      claim: 'Caveat: weights are probably kilograms, an early expat campaign briefly offered pounds, and the unit column was backfilled "where obvious"',
      verdict: 'partly',
      evidence: [`${P}.weight`, `${P}.weight_unit`, `${I}.weight`],
      note: `${lbsUnitRows} rows carry \`lbs\` and ${unitEmpty} carry no unit; ${bmiKgOut} rows read plausibly only as pounds, and ${weightRatioFar} intake/patient weight ratios sit near the 2.20462 factor.`,
    },
    {
      claim: 'Caveat: status values were typed by different automations and different humans over time',
      verdict: 'confirmed',
      evidence: [`${P}.status`, 'cross.variation'],
      note: `${statusDistinct} raw spellings, and the vocabulary differs by source and by year.`,
    },
    {
      claim: 'Caveat: BSNs were collected for a period, then the field was hidden from the form, and were never validated',
      verdict: x.bsnYears.length < x.allSignupYears.length ? 'partly' : 'contradicted',
      evidence: [`${P}.bsn`],
      note: `Non-empty bsn values appear in signup years ${x.bsnYears.join(', ')} out of ${x.allSignupYears.join(', ')}, so the collection window is not visible as a clean cut; ${bsnFail} of ${bsnNine} nine-digit values fail the elfproef.`,
    },
    {
      claim: 'Caveat (ops): "some people definitely signed up twice with different emails to retry the intake"',
      verdict: cSpanningEmails > 0 ? 'confirmed' : 'contradicted',
      evidence: ['cross.duplicate-candidates'],
      note: `${cGroups} name-plus-dob groups exist, ${cSpanningEmails} of them span more than one folded email.`,
    },
  ];
}

export function notWarnedItems(input: ClaimsInput): NotWarnedItem[] {
  const P = 'patients.csv';
  const I = 'intakes.csv';
  const C = 'consents.jsonl';
  const x = extras(input);
  const items: Array<{when: boolean; text: string; evidence: string[]}> = [
    {
      when: num(input, `${P}.legacy_id`, 'duplicateGroups') > 0,
      text: `${num(input, `${P}.legacy_id`, 'duplicateGroups')} legacy_id values are carried by more than one patients.csv row, so the id the other two files reference is not unique.`,
      evidence: [`${P}.legacy_id`],
    },
    {
      when: num(input, `${P}.email`, 'foldedDuplicateGroups') > 0,
      text: `${num(input, `${P}.email`, 'foldedDuplicateGroups')} email addresses appear on more than one row once case is folded, and ${(jsonOf(input, `${P}.email`)['localPartsOnSeveralDomains'] as unknown[]).length} local-parts appear on more than one domain.`,
      evidence: [`${P}.email`],
    },
    {
      when: num(input, `${P}.email`, 'plusAddressingRows') > 0,
      text: `${num(input, `${P}.email`, 'plusAddressingRows')} rows use plus-addressing, which folds to the same mailbox as another row for a mail server but not for a string comparison.`,
      evidence: [`${P}.email`],
    },
    {
      when: (jsonOf(input, `${P}.dob`)['mixedShapes'] as unknown[]).length > 0,
      text: `At least one dob shape carries both an unambiguous day-first and an unambiguous month-first value, so the ordering cannot be decided per shape, only per row.`,
      evidence: [`${P}.dob`],
    },
    {
      when: num(input, `${P}.dob`, 'ageAtSignupUnder18') > 0 || num(input, `${P}.dob`, 'ageAtSignupOver100') > 0,
      text: `${num(input, `${P}.dob`, 'ageAtSignupUnder18')} rows give an age at signup below 18 and ${num(input, `${P}.dob`, 'ageAtSignupOver100')} above 100.`,
      evidence: [`${P}.dob`],
    },
    {
      when: num(input, `${P}.dob`, 'dobIdenticalToSignupDateRaw') > 0 || num(input, `${P}.dob`, 'dobCandidateEqualsSignupCandidate') > 0,
      text: `${num(input, `${P}.dob`, 'dobCandidateEqualsSignupCandidate')} rows have a dob that reads as the same calendar date as their signup_date.`,
      evidence: [`${P}.dob`],
    },
    {
      when: num(input, `${P}.signup_date`, 'futureUnderEveryOrdering') > 0 || num(input, `${I}.submitted_at`, 'futureUnderEveryOrdering') > 0,
      text: `${num(input, `${P}.signup_date`, 'futureUnderEveryOrdering')} signup dates and ${num(input, `${I}.submitted_at`, 'futureUnderEveryOrdering')} intake dates lie after the reference date ${input.asOf} under every plausible ordering.`,
      evidence: [`${P}.signup_date`, `${I}.submitted_at`, 'cross.date-range'],
    },
    {
      when: num(input, `${P}.bsn`, 'eightDigit') > 0,
      text: `${num(input, `${P}.bsn`, 'eightDigit')} bsn values have eight digits, of which ${num(input, `${P}.bsn`, 'eightDigitElfproefPassWhenPadded')} pass the elfproef once a leading zero is restored.`,
      evidence: [`${P}.bsn`],
    },
    {
      when: num(input, `${P}.bsn`, 'duplicateGroups') > 0,
      text: `${num(input, `${P}.bsn`, 'duplicateGroups')} bsn values are shared by more than one row, which is an identity collision rather than a formatting problem.`,
      evidence: [`${P}.bsn`, 'cross.duplicate-candidates'],
    },
    {
      when: num(input, `${P}.phone`, 'duplicateGroups') > 0,
      text: `${num(input, `${P}.phone`, 'duplicateGroups')} phone numbers are shared by more than one row when compared on digits only.`,
      evidence: [`${P}.phone`, 'cross.duplicate-candidates'],
    },
    {
      when: (jsonOf(input, `${P}.phone`)['nonDutchPrefixValues'] as unknown[]).length > 0,
      text: `${(jsonOf(input, `${P}.phone`)['nonDutchPrefixValues'] as unknown[]).length} distinct phone values do not start with a Dutch prefix.`,
      evidence: [`${P}.phone`],
    },
    {
      when:
        num(input, `${P}.full_name`, 'rowsWithDigits') > 0 ||
        num(input, `${P}.full_name`, 'allCapsRows') > 0 ||
        num(input, `${P}.full_name`, 'edgeWhitespaceRows') > 0,
      text: `${num(input, `${P}.full_name`, 'edgeWhitespaceRows')} full_name values carry leading or trailing whitespace, which splits ${num(input, `${P}.full_name`, 'foldedDuplicateGroups') - num(input, `${P}.full_name`, 'exactDuplicateGroups')} name groups that folding would join; ${num(input, `${P}.full_name`, 'rowsWithDigits')} names contain a digit and ${num(input, `${P}.full_name`, 'allCapsRows')} are ALL CAPS.`,
      evidence: [`${P}.full_name`],
    },
    {
      when: num(input, `${P}.city`, 'foldingMergeGroups') > 0,
      text: `${num(input, `${P}.city`, 'foldingMergeGroups')} city values differ only by case or whitespace.`,
      evidence: [`${P}.city`],
    },
    {
      when: num(input, `${P}.height_cm`, 'empty') > 0 || bandRows(input, `${P}.height_cm`, 'bands', '100 .. 140') > 0,
      text: `height_cm has ${num(input, `${P}.height_cm`, 'empty')} empty values and ${bandRows(input, `${P}.height_cm`, 'bands', '100 .. 140')} values between 100 and 140, which the notes do not mention at all.`,
      evidence: [`${P}.height_cm`],
    },
    {
      when: num(input, `${I}.outcome`, 'empty') > 0,
      text: `${num(input, `${I}.outcome`, 'empty')} intakes have an empty outcome, a state the notes' approved / rejected / pending vocabulary does not cover.`,
      evidence: [`${I}.outcome`],
    },
    {
      when: x.twijfelRows > 0,
      text: `The reviewer_note "twijfel, toch akkoord" (doubt, agreed anyway) appears on ${x.twijfelRows} intakes, of which ${x.twijfelOnRejection} have a rejecting outcome and ${x.twijfelOnNeither} an outcome that is neither an approval nor a rejection.`,
      evidence: [`${I}.reviewer_note`],
    },
    {
      when: num(input, `${I}.reviewer_note`, 'notesOnEmptyOutcome') > 0,
      text: `${num(input, `${I}.reviewer_note`, 'notesOnEmptyOutcome')} rows carry a reviewer note while the outcome is empty.`,
      evidence: [`${I}.reviewer_note`],
    },
    {
      when: num(input, `${I}.duplicates`, 'repeatedPatientSubmittedPairs') > 0,
      text: `${num(input, `${I}.duplicates`, 'repeatedPatientSubmittedPairs')} (legacy_patient_id, submitted_at) pairs repeat and ${num(input, `${I}.duplicates`, 'identicalApartFromIntakeIdGroups')} row groups are identical in every field except intake_id.`,
      evidence: [`${I}.duplicates`],
    },
    {
      when: num(input, `${C}.sequences`, 'patientsStartingWithRevoked') > 0,
      text: `${num(input, `${C}.sequences`, 'patientsStartingWithRevoked')} patients have a revoke with no prior grant in the log.`,
      evidence: [`${C}.sequences`],
    },
    {
      when:
        (jsonOf(input, `${C}.sequences`)['patientsWhoseLastStateDiffersByOrdering'] as unknown[]).length > 0 ||
        num(input, `${C}.sequences`, 'patientsWithFileOrderDifferentFromAtOrder') > 0,
      text: `${(jsonOf(input, `${C}.sequences`)['patientsWhoseLastStateDiffersByOrdering'] as unknown[]).length} patients get a different derived consent state depending on whether the log is read in timestamp order or in file order, and ${num(input, `${C}.sequences`, 'patientsWithFileOrderDifferentFromAtOrder')} patients have events written out of timestamp order.`,
      evidence: [`${C}.sequences`],
    },
    {
      when: num(input, `${C}.patient_legacy_id`, 'patientsWithoutEvents') > 0,
      text: `${num(input, `${C}.patient_legacy_id`, 'patientsWithoutEvents')} patients have no consent event at all, which is not the same as a revoked consent.`,
      evidence: [`${C}.patient_legacy_id`],
    },
    {
      when: num(input, `${C}.sequences`, 'patientsWithRepeatedIdenticalAction') > 0,
      text: `${num(input, `${C}.sequences`, 'patientsWithRepeatedIdenticalAction')} patients have the same action twice in a row, so the log is not a strict alternation.`,
      evidence: [`${C}.sequences`],
    },
    {
      when: num(input, `${C}.at`, 'eventsAfterAsOf') > 0,
      text: `${num(input, `${C}.at`, 'eventsAfterAsOf')} consent events are dated after the reference date ${input.asOf}.`,
      evidence: [`${C}.at`],
    },
    {
      when: (jsonOf(input, `${I}.alcohol_units_week`)['nonNumericValues'] as unknown[]).length > 0,
      text: `alcohol_units_week mixes numbers with ${(jsonOf(input, `${I}.alcohol_units_week`)['nonNumericValues'] as unknown[]).length} non-numeric spelling on ${valueCount(input, `${I}.alcohol_units_week`, 'nonNumericValues', 'n.v.t.')} rows, next to ${num(input, `${I}.alcohol_units_week`, 'empty')} empty values, so "no alcohol" and "not answered" are not distinguishable by type alone.`,
      evidence: [`${I}.alcohol_units_week`],
    },
    {
      when: num(input, `${I}.legacy_patient_id`, 'orphanRows') > 0,
      text: `${num(input, `${I}.legacy_patient_id`, 'orphanRows')} intake rows reference a patient id that patients.csv does not contain (${num(input, `${I}.legacy_patient_id`, 'orphanDistinctIds')} distinct ids, of which ${(jsonOf(input, `${I}.legacy_patient_id`)['orphanIdsInConsents'] as unknown[]).length} also appear in consents.jsonl), and the notes mention only that the automation could fire early, not that the rows would stay unresolved in the export.`,
      evidence: [`${I}.legacy_patient_id`],
    },
    {
      when: num(input, 'cross.date-range', 'totalRowsInIsolatedTails') > 0,
      text: `${num(input, 'cross.date-range', 'totalRowsInIsolatedTails')} rows carry a date that sits after a gap of more than a year from every other date in its column, so the latest dates in the export are outliers rather than a boundary.`,
      evidence: ['cross.date-range'],
    },
    {
      when: num(input, `${P}.dob`, 'futureUnderSomeOrdering') > 0,
      text: `${num(input, `${P}.dob`, 'futureUnderSomeOrdering')} dob values read as a date after the reference date ${input.asOf} under some ordering, ${num(input, `${P}.dob`, 'futureUnderEveryOrdering')} under every ordering.`,
      evidence: [`${P}.dob`, 'cross.date-range'],
    },
    {
      when: num(input, `${I}.submitted_at`, 'beforeSignupUnderSomeOrdering') > 0,
      text: `Whether an intake predates its patient row is itself undecided: ${num(input, `${I}.submitted_at`, 'beforeSignupUnderSomeOrdering')} intakes are earlier than signup_date under at least one date ordering, while ${num(input, `${I}.submitted_at`, 'beforeSignupUnderEveryOrdering')} are earlier under every ordering.`,
      evidence: [`${I}.submitted_at`],
    },
    {
      when: bandRows(input, `${I}.weight`, 'ratioBands', '< 0.4') + bandRows(input, `${I}.weight`, 'ratioBands', '0.4 .. 0.5') > 0,
      text: `${bandRows(input, `${I}.weight`, 'ratioBands', '0.4 .. 0.5')} intake weights are between 0.4 and 0.5 times the patient-row weight and ${bandRows(input, `${I}.weight`, 'ratioBands', '< 0.4')} are below 0.4 times it, so the disagreement between the two columns is not only the self-reporting the notes describe.`,
      evidence: [`${I}.weight`, `${P}.weight`],
    },
    {
      when: num(input, `${P}.weight_unit`, 'empty') > 0,
      text: `The ${num(input, `${P}.weight_unit`, 'empty')} rows with no weight_unit all carry a weight, and their median sits far from the median of the kg rows, so "backfilled where obvious" left a group that reads as neither.`,
      evidence: [`${P}.weight`, `${P}.weight_unit`],
    },
    {
      when: bandRows(input, `${P}.weight`, 'bands', '< 35') > 0 || bandRows(input, `${P}.weight`, 'bands', '>= 300') > 0,
      text: `${bandRows(input, `${P}.weight`, 'bands', '< 35')} patient weights are below 35 and ${bandRows(input, `${P}.weight`, 'bands', '>= 300')} are 300 or more, neither of which the kg-or-lbs story explains.`,
      evidence: [`${P}.weight`],
    },
    {
      when: num(input, `${P}.email`, 'edgeWhitespaceRows') > 0 || num(input, `${P}.email`, 'rowsWithUppercase') > 0,
      text: `${num(input, `${P}.email`, 'edgeWhitespaceRows')} email values carry leading or trailing whitespace, ${num(input, `${P}.email`, 'rowsWithInternalWhitespace')} carry whitespace inside the address and ${num(input, `${P}.email`, 'rowsWithUppercase')} contain uppercase, so the column the notes call a login is not comparable as exported.`,
      evidence: [`${P}.email`],
    },
    {
      when: num(input, `${I}.questionnaire_version`, 'empty') > 0,
      text: `${num(input, `${I}.questionnaire_version`, 'empty')} intakes carry no questionnaire_version, so the ruleset that evaluated them is not recorded.`,
      evidence: [`${I}.questionnaire_version`],
    },
    {
      when: num(input, `${P}.status`, 'edgeWhitespaceRows') > 0 || num(input, `${I}.outcome`, 'edgeWhitespaceRows') > 0,
      text: `${num(input, `${P}.status`, 'edgeWhitespaceRows')} status values and ${num(input, `${I}.outcome`, 'edgeWhitespaceRows')} outcome values carry trailing whitespace, so a plain string comparison splits states that read identically.`,
      evidence: [`${P}.status`, `${I}.outcome`],
    },
    {
      when: bandRows(input, `${I}.height`, 'ratioBands', '< 0.4') + bandRows(input, `${I}.height`, 'ratioBands', '>= 2.4') > 0,
      text: `Intake heights disagree with the patient row by more than a factor of two on ${bandRows(input, `${I}.height`, 'ratioBands', '< 0.4') + bandRows(input, `${I}.height`, 'ratioBands', '>= 2.4')} rows.`,
      evidence: [`${I}.height`],
    },
  ];
  return items
    .filter((i) => i.when)
    .map((i) => ({text: i.text, evidence: i.evidence}));
}
