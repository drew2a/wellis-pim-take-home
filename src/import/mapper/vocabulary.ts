// Closed vocabularies (ADR-0005, findings: sex, status, outcome, questionnaire_version, consent
// action). Matching is on the exact raw spelling, `active ` included: the table is the complete
// inventory of this export, and any other spelling is unseen, maps to the enum's `unknown` (or
// null where the enum has none) and is flagged for one vocabulary item per new value.
import type { RuleCode } from './rule-codes';
import { mapped, unchanged, type Mapped } from './types';

export interface VocabularyEntry<T extends string> {
  readonly canonical: T;
  /** Optional rule code that overrides the table's when this spelling is an inference, not a spelling. */
  readonly ruleCode?: RuleCode;
}

export type VocabularyTable<T extends string> = Readonly<Record<string, VocabularyEntry<T>>>;

export interface Vocabulary<T extends string, U> {
  readonly field: string;
  readonly ruleCode: RuleCode;
  readonly table: VocabularyTable<T>;
  /** The canonical value for a raw spelling not in the table. */
  readonly unknown: U;
  /** The canonical value for an empty raw value: empty is empty, never unseen. */
  readonly empty: U;
}

export function mapVocabulary<T extends string, U>(
  raw: string,
  vocabulary: Vocabulary<T, U>,
): Mapped<T | U> {
  const { field } = vocabulary;
  if (raw === '') {
    return unchanged(vocabulary.empty);
  }
  const entry = vocabulary.table[raw];
  if (entry === undefined) {
    const to = typeof vocabulary.unknown === 'string' ? vocabulary.unknown : null;
    return mapped(
      vocabulary.unknown,
      [{ field, from: raw, to, ruleCode: 'VOCAB_UNKNOWN' }],
      [{ kind: 'vocabulary_unseen', field, raw }],
    );
  }
  if (entry.canonical === raw) {
    return unchanged(entry.canonical);
  }
  return mapped(entry.canonical, [
    { field, from: raw, to: entry.canonical, ruleCode: entry.ruleCode ?? vocabulary.ruleCode },
  ]);
}

const spellings = <T extends string>(canonical: T, ...raws: string[]): VocabularyTable<T> =>
  Object.fromEntries(raws.map((raw) => [raw, { canonical }]));

export type Sex = 'male' | 'female' | 'unknown';
export const SEX: Vocabulary<Sex, 'unknown'> = {
  field: 'sex',
  ruleCode: 'VOCAB_SEX',
  table: {
    ...spellings('male', 'male', 'Male', 'M', 'm', 'man'),
    ...spellings('female', 'female', 'Female', 'F', 'f', 'vrouw', 'V'),
  },
  unknown: 'unknown',
  empty: 'unknown',
};

export type PatientStatus = 'active' | 'paused' | 'churned' | 'prospect' | 'unknown';
export const STATUS: Vocabulary<PatientStatus, 'unknown'> = {
  field: 'status',
  ruleCode: 'VOCAB_STATUS',
  table: {
    ...spellings('active', 'active', 'Active', 'active ', 'ACTIEF', 'actief'),
    // Meaning-level assignments, listed under rules applied (ADR-0005): cancelled and opgezegd
    // are churned, on hold and gepauzeerd are paused, new and lead are prospect.
    ...spellings('churned', 'churned', 'Churned', 'cancelled', 'opgezegd'),
    ...spellings('paused', 'paused', 'Paused', 'on hold', 'gepauzeerd'),
    ...spellings('prospect', 'prospect', 'Prospect', 'new', 'lead'),
  },
  unknown: 'unknown',
  empty: 'unknown',
};

export type Outcome = 'approved' | 'rejected' | 'pending' | 'unknown';
export const OUTCOME: Vocabulary<Outcome, 'unknown'> = {
  field: 'outcome',
  ruleCode: 'VOCAB_OUTCOME',
  table: {
    ...spellings('approved', 'approved', 'Approved', 'approved ', 'goedgekeurd'),
    // `OK` is an inference about 441 medical decisions, not a spelling: its own code and a
    // confirmation item, so the rows can be remapped if the answer is no (ADR-0005).
    OK: { canonical: 'approved', ruleCode: 'OUTCOME_OK_ASSUMED_APPROVED' },
    ...spellings('rejected', 'rejected', 'Rejected', 'afgewezen', 'declined'),
    ...spellings('pending', 'pending', 'open', 'wacht op arts', 'in review'),
  },
  unknown: 'unknown',
  empty: 'unknown',
};

export type QuestionnaireVersion = 'v1' | 'v2' | 'v3';
export const QUESTIONNAIRE_VERSION: Vocabulary<QuestionnaireVersion, null> = {
  field: 'questionnaire_version',
  ruleCode: 'VOCAB_UNKNOWN',
  table: {
    ...spellings('v1', 'v1'),
    ...spellings('v2', 'v2'),
    ...spellings('v3', 'v3'),
    // Same treatment as `OK`: an inference with its own code and a confirmation item.
    '2.0': { canonical: 'v2', ruleCode: 'VERSION_LABEL_ASSUMED_V2' },
  },
  unknown: null,
  empty: null,
};

export type ConsentAction = 'granted' | 'revoked';
// The enum has no `unknown`, so an unseen action maps to null and no canonical event is written
// (ADR-0009 item 8).
export const CONSENT_ACTION: Vocabulary<ConsentAction, null> = {
  field: 'action',
  ruleCode: 'VOCAB_UNKNOWN',
  table: { ...spellings('granted', 'granted'), ...spellings('revoked', 'revoked') },
  unknown: null,
  empty: null,
};

/** Consent `type` is stored as text; the closed set is what this export contains (P-30). */
export const CONSENT_TYPES: ReadonlySet<string> = new Set(['data_processing']);
