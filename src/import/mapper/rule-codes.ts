// Every rule code the mapper can write on a normalisation record, with the evidence it rests on
// (ADR-0005 mapping table, ADR-0009 blanking rules). One table so the report and the tests
// enumerate codes from one place; a code that is not here cannot be written.
export const RULE_CODES = {
  WHITESPACE_TRIM: { profile: ['P-2', 'P-3'] },
  EMAIL_LOWERCASE: { profile: 'P-3' },
  EMAIL_PLACEHOLDER_TO_NULL: { profile: 'P-3', placeholders: 11 },
  EMAIL_INTERNAL_SPACE_TO_NULL: { profile: 'P-3', internalSpace: 10 },
  DATE_ORDER_FROM_SEPARATOR: {
    hypothesis: 'H-1',
    convention: { '9999-99-99': 'Y-M-D', '99-99-9999': 'D-M-Y', '99/99/9999': 'M-D-Y' },
    unambiguous: { dob: 1479, signup_date: 1499, submitted_at: 1804 },
    counterexamples: 0,
  },
  DATE_IMPOSSIBLE_TO_NULL: { profile: ['P-4', 'P-13', 'P-18', 'P-35'] },
  DATE_UNREADABLE_TO_NULL: { profile: ['P-4', 'P-13', 'P-18'] },
  VOCAB_SEX: { profile: 'P-5', hypothesis: 'H-4' },
  VOCAB_STATUS: {
    profile: 'P-12',
    hypothesis: 'H-4',
    meaningLevel: { cancelled: 'churned', 'on hold': 'paused', new: 'prospect', lead: 'prospect' },
  },
  VOCAB_OUTCOME: { profile: 'P-25', hypothesis: 'H-4' },
  OUTCOME_OK_ASSUMED_APPROVED: {
    profile: 'P-25',
    hypothesis: 'H-4',
    inference:
      'OK appears in every year alongside approved; rejected and pending have their own spellings',
  },
  VERSION_LABEL_ASSUMED_V2: { profile: 'P-19', inference: '2.0 read as questionnaire v2' },
  VOCAB_UNKNOWN: { profile: ['P-5', 'P-10', 'P-12', 'P-19', 'P-25', 'P-30'] },
  BSN_MALFORMED_TO_NULL: { profile: 'P-6' },
  PHONE_E164_NL_MOBILE: { profile: 'P-7', forms: ['06-99999999', '0699999999'] },
  PHONE_UNPARSED_TO_NULL: { profile: 'P-7' },
  WEIGHT_LBS_TO_KG: { profile: ['P-9', 'P-10'], hypothesis: 'H-2', factor: 0.45359237 },
  WEIGHT_UNIT_MISSING_TO_NULL: { profile: 'P-10', hypothesis: 'H-2', rows: 18 },
  IMPLAUSIBLE_TO_NULL: { profile: ['P-9', 'P-11', 'P-20', 'P-21'], hypothesis: 'H-3' },
  NON_NUMERIC_TO_NULL: { profile: 'P-24' },
  VOCAB_NONE_MEDICATION: { profile: 'P-22' },
  VOCAB_NONE_CONDITION: { profile: 'P-23' },
  TIMESTAMP_ZONE_ASSUMED: {
    profile: 'P-31',
    zone: 'Europe/Amsterdam',
    inference: 'every event between 07:00 and 22:59 local, none at night',
  },
} as const;

export type RuleCode = keyof typeof RULE_CODES;
