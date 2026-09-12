// Shape of rules/v1.json (ADR-0005): the plausibility bounds, the divergence tolerance, the age
// and BMI thresholds with their boundary semantics, and the three term lists. The importer, the
// detectors and the Part B engine read these values from here and define them nowhere else.
import { z } from 'zod';

// Bounds are validated as a pair so that min >= max cannot pass as two individually valid numbers.
const bounds = z
  .object({ min: z.number(), max: z.number() })
  .refine((b) => b.min < b.max, { message: 'min must be below max' });

// Matching lowercases the input and looks for the term on word boundaries (ADR-0005), so a term
// with an uppercase letter could never match; refusing it here is cheaper than a silent miss. A
// term without a letter or a digit is worse than useless: matching keeps letters and digits and
// makes every other character a boundary, so `-` tokenises to nothing and would match every
// segment. Both are caught at load, before a single row is read (`CLAUDE.md` §2).
const term = z
  .string()
  .trim()
  .min(1)
  .refine((t) => t === t.toLowerCase(), { message: 'terms are lowercase' })
  .refine((t) => /[\p{L}\p{N}]/u.test(t), { message: 'terms need a letter or a digit' });
const termList = z.array(term).nonempty();

// The rules the engine can name in a precedence statement: the two that reject (ADR-0010). A
// ruleset marks one absolute — age under 18 is a legal gate a reviewer cannot resolve in the
// patient's favour — and leaves the rest to yield to a flag.
export const REJECT_RULES = ['age_below_minimum', 'bmi_below_minimum'] as const;
export type RejectRule = (typeof REJECT_RULES)[number];

export const rulesSchema = z.object({
  version: z.literal('v1'),
  plausibility: z.object({ weight_kg: bounds, height_cm: bounds }),
  weight_divergence: z.object({ tolerance: bounds }),
  age: z.object({
    minimum_years: z.number().int().positive(),
    // Q4 default: age is measured at submission (QUESTIONS.md).
    reference: z.literal('submitted_at'),
  }),
  bmi: z.object({
    reject_below: z.number().positive(),
    flag_band: z.object({
      min: z.number().positive(),
      max: z.number().positive(),
      min_inclusive: z.boolean(),
      max_inclusive: z.boolean(),
    }),
    // Q2 default: thresholds apply to the unrounded value; rounding is for display only.
    rounding: z.literal('none'),
  }),
  // Q1 default (ADR-0010): collect every match, then resolve. Required, so a ruleset that states
  // no precedence fails at load rather than falling back to a default buried in the engine.
  precedence: z.object({
    absolute_rejects: z.array(z.enum(REJECT_RULES)),
    flag_preempts_reject: z.boolean(),
  }),
  glp1_terms: termList,
  flag_condition_terms: termList,
  weight_related_condition_terms: termList,
});

export type Rules = z.infer<typeof rulesSchema>;
