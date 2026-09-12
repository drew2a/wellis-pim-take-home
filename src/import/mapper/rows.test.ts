import { describe, expect, it } from 'vitest';

import { loadRules } from '@/rules/load';

import { mapConsentEvent } from './consent-event';
import { mapIntake, type RawIntake } from './intake';
import { mapPatient, type RawPatient } from './patient';

const context = { asOf: '2026-09-08', rules: loadRules() };

const patient = (overrides: Partial<RawPatient> = {}): RawPatient => ({
  legacy_id: 'rec000000000000001',
  full_name: 'Zeynep Chen',
  email: 'zeynep.chen@live.nl',
  dob: '23-08-2000',
  sex: 'female',
  bsn: '251508596',
  phone: '06-53549409',
  city: 'Delft',
  weight: '134.0',
  weight_unit: 'kg',
  height_cm: '194',
  status: 'Active',
  signup_date: '2023-03-21',
  source: 'import',
  ...overrides,
});

const intake = (overrides: Partial<RawIntake> = {}): RawIntake => ({
  intake_id: 'INT-9521',
  legacy_patient_id: 'rec000000000000001',
  submitted_at: '05-06-2023',
  questionnaire_version: 'v1',
  weight: '83.6',
  height: '162',
  meds_current: 'metformine 500mg',
  conditions: 'hoge bloeddruk',
  alcohol_units_week: '10',
  outcome: 'Rejected',
  reviewer_note: 'twijfel, toch akkoord',
  ...overrides,
});

describe('mapPatient', () => {
  it('maps the first row of the export with the records the table predicts', () => {
    const result = mapPatient(patient(), context);
    expect(result.legacyId).toBe('rec000000000000001');
    expect(result.canonical).toEqual({
      fullName: 'Zeynep Chen',
      email: 'zeynep.chen@live.nl',
      dob: '2000-08-23',
      sex: 'female',
      bsn: '251508596',
      bsnCheck: 'valid',
      phone: '+31653549409',
      city: 'Delft',
      weightKg: '134.0',
      heightCm: 194,
      status: 'active',
      signupDate: '2023-03-21',
      source: 'import',
    });
    expect(result.records.map((r) => `${r.field}:${r.ruleCode}`)).toEqual([
      'dob:DATE_ORDER_FROM_SEPARATOR',
      'phone:PHONE_E164_NL_MOBILE',
      'status:VOCAB_STATUS',
    ]);
    expect(result.flags).toEqual([]);
    expect(result.dobAlternative).toBeNull();
  });

  it('checks the dob age against the signup date read under the convention', () => {
    const result = mapPatient(patient({ dob: '1920-01-01', signup_date: '04/17/2024' }), context);
    expect(result.canonical.dob).toBeNull();
    expect(result.canonical.signupDate).toBe('2024-04-17');
    expect(result.flags).toEqual([
      {
        kind: 'date_impossible',
        field: 'dob',
        raw: '1920-01-01',
        read: '1920-01-01',
        reason: 'age_above_100_at_signup',
      },
    ]);
  });

  it('stores empty city and source as null and keeps the alternative dob reading', () => {
    const result = mapPatient(patient({ city: '', source: '', dob: '03-02-1960' }), context);
    expect(result.canonical.city).toBeNull();
    expect(result.canonical.source).toBeNull();
    expect(result.dobAlternative).toBe('1960-03-02');
  });
});

describe('mapIntake', () => {
  it('maps the first row of the export and derives the legacy state from the outcome', () => {
    const result = mapIntake(intake(), context);
    expect(result.canonical).toEqual({
      submittedAt: '2023-06-05',
      questionnaireVersionLabel: 'v1',
      questionnaireVersion: 'v1',
      weightKg: '83.6',
      heightCm: 162,
      medsCurrentRaw: 'metformine 500mg',
      medicationReport: 'reported',
      conditionsRaw: 'hoge bloeddruk',
      conditionReport: 'reported',
      alcoholUnitsWeek: 10,
      outcome: 'rejected',
      outcomeRaw: 'Rejected',
      reviewerNote: 'twijfel, toch akkoord',
      state: 'legacy_rejected',
    });
    expect(result.records.map((r) => `${r.field}:${r.ruleCode}`)).toEqual([
      'outcome:VOCAB_OUTCOME',
      'submitted_at:DATE_ORDER_FROM_SEPARATOR',
    ]);
  });

  it.each([
    ['OK', 'approved', 'legacy_approved'],
    ['afgewezen', 'rejected', 'legacy_rejected'],
    ['wacht op arts', 'pending', 'legacy_pending'],
    ['maybe', 'unknown', 'legacy_pending'],
  ] as const)('outcome %s gives %s in state %s', (raw, outcome, state) => {
    const result = mapIntake(intake({ outcome: raw }), context);
    expect(result.canonical.outcome).toBe(outcome);
    expect(result.canonical.state).toBe(state);
    expect(result.canonical.outcomeRaw).toBe(raw);
  });

  it('keeps the raw label, maps 2.0 to v2, and stores empty text columns as null', () => {
    const result = mapIntake(
      intake({
        questionnaire_version: '2.0',
        meds_current: '',
        conditions: 'geen',
        reviewer_note: '',
      }),
      context,
    );
    expect(result.canonical.questionnaireVersionLabel).toBe('2.0');
    expect(result.canonical.questionnaireVersion).toBe('v2');
    expect(result.canonical.medsCurrentRaw).toBeNull();
    expect(result.canonical.medicationReport).toBe('not_answered');
    expect(result.canonical.conditionsRaw).toBe('geen');
    expect(result.canonical.conditionReport).toBe('none_reported');
    expect(result.canonical.reviewerNote).toBeNull();
  });
});

describe('mapConsentEvent', () => {
  const line = {
    patient_legacy_id: 'recebn1o06VYqjKPp',
    type: 'data_processing',
    action: 'granted',
    at: '2024-05-06T07:37:00',
    version: 'v2',
  };

  it('maps a line to an event with one zone record', () => {
    const result = mapConsentEvent(1, line);
    expect(result.canonical).toEqual({
      type: 'data_processing',
      action: 'granted',
      at: new Date('2024-05-06T05:37:00.000Z'),
      version: 'v2',
    });
    expect(result.records.map((r) => r.ruleCode)).toEqual(['TIMESTAMP_ZONE_ASSUMED']);
    expect(result.flags).toEqual([]);
  });

  it('writes no event for an unseen action or an unreadable time, and flags both', () => {
    expect(mapConsentEvent(2, { ...line, action: 'withdrawn' }).canonical).toBeNull();
    expect(mapConsentEvent(2, { ...line, action: 'withdrawn' }).flags[0]).toMatchObject({
      kind: 'vocabulary_unseen',
      field: 'action',
    });
    const bad = mapConsentEvent(3, { ...line, at: 'never' });
    expect(bad.canonical).toBeNull();
    expect(bad.records).toEqual([]);
    expect(bad.flags).toEqual([{ kind: 'timestamp_unparsed', field: 'at', raw: 'never' }]);
  });

  it('keeps an unseen type on the event and flags it', () => {
    const result = mapConsentEvent(4, { ...line, type: 'marketing' });
    expect(result.canonical?.type).toBe('marketing');
    expect(result.flags).toEqual([{ kind: 'vocabulary_unseen', field: 'type', raw: 'marketing' }]);
  });
});
