// Shape of rules/v1.json (ADR-0005): the plausibility bounds, the divergence tolerance, the age
// and BMI thresholds with their boundary semantics, and the three term lists. The importer, the
// detectors and the Part B engine read these values from here and define them nowhere else.
import { z } from 'zod';

// Bounds are validated as a pair so that min >= max cannot pass as two individually valid numbers.
const bounds = z
  .object({ min: z.number(), max: z.number() })
  .refine((b) => b.min < b.max, { message: 'min must be below max' });

// Matching lowercases the input and looks for the term on word boundaries (ADR-0005), so a term
// with an uppercase letter could never match; refusing it here is cheaper than a silent miss.
const term = z
  .string()
  .trim()
  .min(1)
  .refine((t) => t === t.toLowerCase(), { message: 'terms are lowercase' });
const termList = z.array(term).nonempty();

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
  glp1_terms: termList,
  flag_condition_terms: termList,
  weight_related_condition_terms: termList,
});

export type Rules = z.infer<typeof rulesSchema>;
