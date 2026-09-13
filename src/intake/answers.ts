// What the intake form asks and what a submission has to contain (ADR-0015 item 2), as types and
// as the Zod schemas that validate them at the boundary (ADR-0003, `CLAUDE.md` §2).
//
// Nothing here trims, lowercases or otherwise changes a value: `intakes.answers` keeps what the
// patient typed, and the canonicalisation of a name or an email happens later, with a
// normalisation record to say so (ADR-0015 item 5). The schemas therefore validate the *trimmed*
// form of a value while accepting the original.
//
// The bounds are not written here either. They come from `rules/v1.json` (plausibility) and from
// one shared constant (the age bound the importer also uses), so the form and the importer cannot
// disagree about what is possible.
import { z } from 'zod';

import { CONSENT_TEXT_VERSION } from '@/consent/text';
import { ageInYears, MAX_PLAUSIBLE_AGE_YEARS } from '@/eligibility/age';
import type { EligibilityInput } from '@/eligibility/types';
import { EMAIL_SYNTAX } from '@/import/mapper/email';
import type { Rules } from '@/rules/schema';

import { CONDITION_OPTIONS, GLP1_OPTIONS, optionValues, type ChecklistOption } from './options';

/** Stamped into the answers and onto `intakes.questionnaire_version_label` (ADR-0015 item 1). */
export const INTAKE_FORM_VERSION = 'intake-form-v1';

/**
 * The steps in the order the patient walks through them (ADR-0019).
 *
 * Consent is first because it is permission to process the answers that follow: asking it last
 * meant a patient who declined had already sent their date of birth, their weight and their
 * diagnoses. This is the only place the order is written down — the form derives its screens from
 * it, and `POST /api/intakes` names the first step in a test that reads it back.
 */
export const INTAKE_STEPS = [
  'consent',
  'identity',
  'metrics',
  'medications',
  'conditions',
] as const;
export type IntakeStep = (typeof INTAKE_STEPS)[number];

export interface IdentityAnswers {
  readonly fullName: string;
  readonly email: string;
  /** `YYYY-MM-DD`, as the date input produces it. */
  readonly dob: string;
}

export interface MetricsAnswers {
  readonly heightCm: number;
  readonly weightKg: number;
}

export interface MedicationAnswers {
  /** The structured answer the engine evaluates (ADR-0015 item 6), not a hint. */
  readonly glp1Declared: boolean;
  /** Ticked GLP-1 options, each one a ruleset term. */
  readonly glp1: readonly string[];
  /** Anything else the patient takes, in their words. */
  readonly otherMedications: string;
}

export interface ConditionAnswers {
  /** Ticked condition options, each one a ruleset term. */
  readonly conditions: readonly string[];
  readonly otherConditions: string;
}

export interface ConsentAnswers {
  readonly granted: true;
  readonly textVersion: string;
}

/** A draft in progress: every step is optional until it has been saved. */
export interface DraftAnswers {
  readonly formVersion: string;
  readonly consent?: ConsentAnswers;
  readonly identity?: IdentityAnswers;
  readonly metrics?: MetricsAnswers;
  readonly medications?: MedicationAnswers;
  readonly conditions?: ConditionAnswers;
}

/** A draft that is ready to submit: every step answered. */
export interface SubmittedAnswers extends DraftAnswers {
  readonly consent: ConsentAnswers;
  readonly identity: IdentityAnswers;
  readonly metrics: MetricsAnswers;
  readonly medications: MedicationAnswers;
  readonly conditions: ConditionAnswers;
}

export const emptyAnswers = (): DraftAnswers => ({ formVersion: INTAKE_FORM_VERSION });

/** What the schemas need from outside: the ruleset's bounds and the day the form is filled in. */
export interface AnswersContext {
  readonly rules: Rules;
  /** `YYYY-MM-DD`. Age and "in the past" are measured against it, never against the wall clock. */
  readonly todayIso: string;
}

const trimmed = (value: string): string => value.trim();

/** A real calendar day, not merely a well-shaped string: `2023-02-30` matches the shape. */
function isCalendarDate(iso: string): boolean {
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso;
}

const oneDecimal = (value: number): boolean => Number(value.toFixed(1)) === value;

function identitySchema(context: AnswersContext): z.ZodType<IdentityAnswers> {
  return z.object({
    fullName: z
      .string()
      .max(200)
      .refine((value) => trimmed(value) !== '', { message: 'Enter your full name.' }),
    email: z
      .string()
      .max(320)
      .refine((value) => EMAIL_SYNTAX.test(trimmed(value).toLowerCase()), {
        message: 'Enter an email address in the form name@example.com.',
      }),
    dob: z
      .string()
      .refine(isCalendarDate, { message: 'Enter your date of birth as YYYY-MM-DD.' })
      .refine((dob) => dob < context.todayIso, {
        message: 'Your date of birth must be in the past.',
      })
      .refine((dob) => ageInYears(dob, context.todayIso) <= MAX_PLAUSIBLE_AGE_YEARS, {
        message: `Enter a date of birth giving an age of at most ${MAX_PLAUSIBLE_AGE_YEARS}.`,
      }),
  });
}

/**
 * Shifts an ISO day by whole years, staying on a real calendar day: a 29 February moved onto a
 * non-leap year would roll into 1 March, so it steps back onto 28 February instead.
 */
function shiftYears(iso: string, years: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y - years, m - 1, d));
  if (date.getUTCDate() !== d) date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

const shiftDays = (iso: string, days: number): string => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/**
 * The days the date-of-birth field offers, so the browser refuses a six-digit year before the
 * server has to.
 *
 * They are `identitySchema`'s own two rules expressed as days — a date in the past, an age of at
 * most `MAX_PLAUSIBLE_AGE_YEARS` — derived here rather than written down again, so the field and
 * the schema cannot drift. A convenience, not an authority: the server re-validates every
 * submission and is the only thing that decides (`CLAUDE.md` §2, R-T4).
 *
 * The early bound is the oldest accepted *birthday*, which is not the same as the day a full
 * `MAX_PLAUSIBLE_AGE_YEARS + 1` years ago: age turns over on a birthday, so everyone born after
 * that day is still within the bound today. Taking the looser of the two matters — a field that
 * refused a date the server accepts would be the client overruling the server, which is exactly
 * what it may not do.
 */
export function dobBounds(todayIso: string): { readonly min: string; readonly max: string } {
  return {
    min: shiftDays(shiftYears(todayIso, MAX_PLAUSIBLE_AGE_YEARS + 1), 1),
    max: shiftDays(todayIso, -1),
  };
}

function metricsSchema(context: AnswersContext): z.ZodType<MetricsAnswers> {
  const { height_cm: height, weight_kg: weight } = context.rules.plausibility;
  return z.object({
    heightCm: z
      .number()
      .int({ message: 'Enter your height in whole centimetres.' })
      .min(height.min, {
        message: `Enter a height in centimetres between ${height.min} and ${height.max}.`,
      })
      .max(height.max, {
        message: `Enter a height in centimetres between ${height.min} and ${height.max}.`,
      }),
    weightKg: z
      .number()
      .min(weight.min, {
        message: `Enter a weight in kilograms between ${weight.min} and ${weight.max}.`,
      })
      .max(weight.max, {
        message: `Enter a weight in kilograms between ${weight.min} and ${weight.max}.`,
      })
      .refine(oneDecimal, { message: 'Enter a weight with at most one decimal place.' }),
  });
}

/** A ticked option value: one of the checklist's values, which are ruleset terms (item 2). */
function optionValue(options: readonly ChecklistOption[]): z.ZodType<string> {
  const allowed = new Set(optionValues(options));
  return z.string().refine((value) => allowed.has(value), { message: 'Unknown option.' });
}

const distinct = (values: readonly string[]): boolean => new Set(values).size === values.length;

function medicationsSchema(): z.ZodType<MedicationAnswers> {
  return z
    .object({
      glp1Declared: z.boolean(),
      glp1: z
        .array(optionValue(GLP1_OPTIONS))
        .refine(distinct, { message: 'A medication was selected twice.' }),
      otherMedications: z.string().max(1000),
    })
    .refine((answers) => answers.glp1Declared || answers.glp1.length === 0, {
      message: 'You selected a GLP-1 medication but answered that you use none.',
    })
    .refine(
      (answers) =>
        !answers.glp1Declared ||
        answers.glp1.length > 0 ||
        trimmed(answers.otherMedications) !== '',
      { message: 'Tell us which GLP-1 medication you are using.' },
    );
}

function conditionsSchema(): z.ZodType<ConditionAnswers> {
  return z.object({
    conditions: z
      .array(optionValue(CONDITION_OPTIONS))
      .refine(distinct, { message: 'A condition was selected twice.' }),
    otherConditions: z.string().max(1000),
  });
}

/**
 * Consent is an explicit grant naming the version of the text the patient was shown (ADR-0015
 * item 4). A literal `true` and a literal version: an absent, false or stale consent is a
 * validation failure, which is how submit returns 400 without a special case for it.
 */
function consentSchema(): z.ZodType<ConsentAnswers> {
  return z.object({
    granted: z.literal(true, {
      // Said as "go on" rather than "submit": since ADR-0019 this is the first screen, and the
      // patient reading it has nothing to submit yet.
      message: 'You have to agree to the consent statement before you can go on.',
    }),
    textVersion: z.literal(CONSENT_TEXT_VERSION, {
      message: 'The consent text has changed. Read it again and agree to the current version.',
    }),
  });
}

export type StepSchemas = {
  readonly [S in IntakeStep]: z.ZodType<NonNullable<DraftAnswers[S]>>;
};

export function stepSchemas(context: AnswersContext): StepSchemas {
  return {
    consent: consentSchema(),
    identity: identitySchema(context),
    metrics: metricsSchema(context),
    medications: medicationsSchema(),
    conditions: conditionsSchema(),
  };
}

/** The whole submission: every step, validated again at submit whatever a draft already held. */
export function submittedAnswersSchema(context: AnswersContext): z.ZodType<SubmittedAnswers> {
  const steps = stepSchemas(context);
  return z.object({
    formVersion: z.literal(INTAKE_FORM_VERSION),
    identity: steps.identity,
    metrics: steps.metrics,
    medications: steps.medications,
    conditions: steps.conditions,
    consent: steps.consent,
  });
}

/**
 * The engine's input (ADR-0010, amended by ADR-0015 item 6). The ticked options are ruleset terms
 * and the free text is the patient's own words; both go to `medications`, which is matched for
 * GLP-1 terms, while the condition checklist is the authoritative answer and the condition free
 * text can only add a flag.
 */
export function eligibilityInputOf(
  answers: SubmittedAnswers,
  submittedAtIso: string,
): EligibilityInput {
  const nonEmpty = (value: string): string[] => (trimmed(value) === '' ? [] : [value]);
  return {
    ageYears: ageInYears(answers.identity.dob, submittedAtIso),
    weightKg: answers.metrics.weightKg,
    heightCm: answers.metrics.heightCm,
    glp1Declared: answers.medications.glp1Declared,
    medications: [...answers.medications.glp1, ...nonEmpty(answers.medications.otherMedications)],
    conditions: [...answers.conditions.conditions],
    conditionsOther: nonEmpty(answers.conditions.otherConditions),
  };
}

/** `reported` unless the patient answered that there is nothing to report (`CLAUDE.md` §6). */
export function medicationReportOf(answers: SubmittedAnswers): 'none_reported' | 'reported' {
  const { glp1Declared, glp1, otherMedications } = answers.medications;
  return glp1Declared || glp1.length > 0 || trimmed(otherMedications) !== ''
    ? 'reported'
    : 'none_reported';
}

export function conditionReportOf(answers: SubmittedAnswers): 'none_reported' | 'reported' {
  const { conditions, otherConditions } = answers.conditions;
  return conditions.length > 0 || trimmed(otherConditions) !== '' ? 'reported' : 'none_reported';
}
