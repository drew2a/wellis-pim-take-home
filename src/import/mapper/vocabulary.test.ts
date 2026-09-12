import { describe, expect, it } from 'vitest';

import {
  CONSENT_ACTION,
  OUTCOME,
  QUESTIONNAIRE_VERSION,
  SEX,
  STATUS,
  mapVocabulary,
} from './vocabulary';

describe('sex (VOCAB_SEX)', () => {
  it('keeps the canonical spellings without a record', () => {
    expect(mapVocabulary('male', SEX)).toEqual({ value: 'male', records: [], flags: [] });
    expect(mapVocabulary('female', SEX)).toEqual({ value: 'female', records: [], flags: [] });
  });
  it.each([
    ['M', 'male'],
    ['m', 'male'],
    ['Male', 'male'],
    ['man', 'male'],
    ['F', 'female'],
    ['f', 'female'],
    ['Female', 'female'],
    ['vrouw', 'female'],
    ['V', 'female'],
  ])('maps %s to %s with one record', (raw, canonical) => {
    expect(mapVocabulary(raw, SEX)).toEqual({
      value: canonical,
      records: [{ field: 'sex', from: raw, to: canonical, ruleCode: 'VOCAB_SEX' }],
      flags: [],
    });
  });
  it('maps an unseen spelling to unknown with VOCAB_UNKNOWN and a flag', () => {
    expect(mapVocabulary('x', SEX)).toEqual({
      value: 'unknown',
      records: [{ field: 'sex', from: 'x', to: 'unknown', ruleCode: 'VOCAB_UNKNOWN' }],
      flags: [{ kind: 'vocabulary_unseen', field: 'sex', raw: 'x' }],
    });
  });
  it('maps empty to unknown with no record', () => {
    expect(mapVocabulary('', SEX)).toEqual({ value: 'unknown', records: [], flags: [] });
  });
});

describe('status (VOCAB_STATUS)', () => {
  it.each([
    ['ACTIEF', 'active'],
    ['active ', 'active'],
    ['cancelled', 'churned'],
    ['opgezegd', 'churned'],
    ['on hold', 'paused'],
    ['gepauzeerd', 'paused'],
    ['new', 'prospect'],
    ['lead', 'prospect'],
  ])('maps %s to %s under VOCAB_STATUS, trailing space included', (raw, canonical) => {
    const result = mapVocabulary(raw, STATUS);
    expect(result.value).toBe(canonical);
    expect(result.records).toEqual([
      { field: 'status', from: raw, to: canonical, ruleCode: 'VOCAB_STATUS' },
    ]);
  });
  it('is exact on spelling: `Active ` with a trailing space is unseen', () => {
    expect(mapVocabulary('Active ', STATUS).flags).toHaveLength(1);
  });
});

describe('outcome (VOCAB_OUTCOME, OUTCOME_OK_ASSUMED_APPROVED)', () => {
  it('maps OK to approved under its own code, not VOCAB_OUTCOME', () => {
    expect(mapVocabulary('OK', OUTCOME)).toEqual({
      value: 'approved',
      records: [
        { field: 'outcome', from: 'OK', to: 'approved', ruleCode: 'OUTCOME_OK_ASSUMED_APPROVED' },
      ],
      flags: [],
    });
  });
  it.each([
    ['goedgekeurd', 'approved'],
    ['approved ', 'approved'],
    ['afgewezen', 'rejected'],
    ['declined', 'rejected'],
    ['wacht op arts', 'pending'],
    ['open', 'pending'],
    ['in review', 'pending'],
  ])('maps %s to %s under VOCAB_OUTCOME', (raw, canonical) => {
    expect(mapVocabulary(raw, OUTCOME).records).toEqual([
      { field: 'outcome', from: raw, to: canonical, ruleCode: 'VOCAB_OUTCOME' },
    ]);
  });
  it('keeps approved, rejected and pending without a record', () => {
    for (const raw of ['approved', 'rejected', 'pending']) {
      expect(mapVocabulary(raw, OUTCOME).records).toEqual([]);
    }
  });
  it('does not fold ok or Ok: only the exact spelling OK is the inference', () => {
    expect(mapVocabulary('ok', OUTCOME).value).toBe('unknown');
  });
});

describe('questionnaire_version', () => {
  it('maps 2.0 to v2 under VERSION_LABEL_ASSUMED_V2', () => {
    expect(mapVocabulary('2.0', QUESTIONNAIRE_VERSION)).toEqual({
      value: 'v2',
      records: [
        {
          field: 'questionnaire_version',
          from: '2.0',
          to: 'v2',
          ruleCode: 'VERSION_LABEL_ASSUMED_V2',
        },
      ],
      flags: [],
    });
  });
  it('keeps v1, v2, v3 and maps empty to null, all without a record', () => {
    expect(mapVocabulary('v3', QUESTIONNAIRE_VERSION).records).toEqual([]);
    expect(mapVocabulary('', QUESTIONNAIRE_VERSION)).toEqual({
      value: null,
      records: [],
      flags: [],
    });
  });
  it('maps an unseen label to null with a blanking record and a flag', () => {
    expect(mapVocabulary('V2', QUESTIONNAIRE_VERSION)).toEqual({
      value: null,
      records: [
        { field: 'questionnaire_version', from: 'V2', to: null, ruleCode: 'VOCAB_UNKNOWN' },
      ],
      flags: [{ kind: 'vocabulary_unseen', field: 'questionnaire_version', raw: 'V2' }],
    });
  });
});

describe('consent action', () => {
  it('keeps granted and revoked, and maps anything else to null with a flag', () => {
    expect(mapVocabulary('granted', CONSENT_ACTION).value).toBe('granted');
    expect(mapVocabulary('revoked', CONSENT_ACTION).records).toEqual([]);
    const unseen = mapVocabulary('withdrawn', CONSENT_ACTION);
    expect(unseen.value).toBeNull();
    expect(unseen.flags).toEqual([
      { kind: 'vocabulary_unseen', field: 'action', raw: 'withdrawn' },
    ]);
  });
});
