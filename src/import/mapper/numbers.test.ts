import { describe, expect, it } from 'vitest';

import { mapConditionReport, mapMedicationReport } from './history-report';
import { mapAlcoholUnits, mapHeight, mapIntakeWeight, mapPatientWeight } from './numbers';

const WEIGHT = { min: 30, max: 300 };
const HEIGHT = { min: 100, max: 230 };

describe('mapPatientWeight', () => {
  it('stores a kilogram value unchanged, to one decimal', () => {
    expect(mapPatientWeight('134.0', 'kg', WEIGHT)).toEqual({
      value: '134.0',
      records: [],
      flags: [],
    });
    expect(mapPatientWeight('94', 'kg', WEIGHT).value).toBe('94.0');
  });

  it('converts 225 lbs to 102.1 under WEIGHT_LBS_TO_KG', () => {
    const result = mapPatientWeight('225', 'lbs', WEIGHT);
    expect(result.value).toBe('102.1');
    expect(result.records).toEqual([
      {
        field: 'weight_kg',
        from: '225',
        to: '102.1',
        ruleCode: 'WEIGHT_LBS_TO_KG',
        detail: { factor: 0.45359237 },
      },
    ]);
    expect(result.flags).toEqual([]);
  });

  it('judges plausibility after conversion: 356.9 lbs is 161.9 kg and stays', () => {
    expect(mapPatientWeight('356.9', 'lbs', WEIGHT).value).toBe('161.9');
  });

  it('blanks a weight with no unit under WEIGHT_UNIT_MISSING_TO_NULL and flags it', () => {
    expect(mapPatientWeight('80.5', '', WEIGHT)).toEqual({
      value: null,
      records: [
        { field: 'weight_kg', from: '80.5', to: null, ruleCode: 'WEIGHT_UNIT_MISSING_TO_NULL' },
      ],
      flags: [{ kind: 'weight_unit_missing', field: 'weight_kg', raw: '80.5' }],
    });
  });

  // ADR-0009 item 1: the record that explains the stored null names the column that is nulled,
  // so weight_kg needs its own record; weight_unit has no canonical column of its own.
  it('blanks an unseen unit with VOCAB_UNKNOWN on both weight_kg and weight_unit', () => {
    const result = mapPatientWeight('12.0', 'st', WEIGHT);
    expect(result.value).toBeNull();
    expect(result.records).toEqual([
      {
        field: 'weight_kg',
        from: '12.0',
        to: null,
        ruleCode: 'VOCAB_UNKNOWN',
        detail: { weight_unit: 'st' },
      },
      { field: 'weight_unit', from: 'st', to: null, ruleCode: 'VOCAB_UNKNOWN' },
    ]);
    expect(result.flags).toEqual([{ kind: 'vocabulary_unseen', field: 'weight_unit', raw: 'st' }]);
  });

  it('applies the bounds inclusively and blanks with IMPLAUSIBLE_TO_NULL outside them', () => {
    expect(mapPatientWeight('30.0', 'kg', WEIGHT).value).toBe('30.0');
    expect(mapPatientWeight('300.0', 'kg', WEIGHT).value).toBe('300.0');
    expect(mapPatientWeight('29.9', 'kg', WEIGHT).value).toBeNull();
    const tiny = mapPatientWeight('7.8', 'kg', WEIGHT);
    expect(tiny.records).toEqual([
      {
        field: 'weight_kg',
        from: '7.8',
        to: null,
        ruleCode: 'IMPLAUSIBLE_TO_NULL',
        detail: { bounds: WEIGHT },
      },
    ]);
    expect(tiny.flags).toEqual([
      { kind: 'implausible', field: 'weight_kg', raw: '7.8', value: 7.8 },
    ]);
  });

  it('chains lbs conversion and the implausibility blank', () => {
    const result = mapPatientWeight('10.0', 'lbs', WEIGHT);
    expect(result.records.map((r) => [r.ruleCode, r.from, r.to])).toEqual([
      ['WEIGHT_LBS_TO_KG', '10.0', '4.5'],
      ['IMPLAUSIBLE_TO_NULL', '4.5', null],
    ]);
  });

  it('stores empty as null with no record and blanks a non-number with NON_NUMERIC_TO_NULL', () => {
    expect(mapPatientWeight('', 'kg', WEIGHT)).toEqual({ value: null, records: [], flags: [] });
    expect(mapPatientWeight('80,5', 'kg', WEIGHT).records[0]?.ruleCode).toBe('NON_NUMERIC_TO_NULL');
    expect(mapPatientWeight('80.55', 'kg', WEIGHT).records[0]?.ruleCode).toBe(
      'NON_NUMERIC_TO_NULL',
    );
  });
});

describe('mapIntakeWeight (kilograms by assumption)', () => {
  it('stores unchanged inside the bounds and blanks outside', () => {
    expect(mapIntakeWeight('83.6', WEIGHT)).toEqual({ value: '83.6', records: [], flags: [] });
    expect(mapIntakeWeight('5.7', WEIGHT).value).toBeNull();
    expect(mapIntakeWeight('5.7', WEIGHT).records[0]?.ruleCode).toBe('IMPLAUSIBLE_TO_NULL');
  });
});

describe('mapHeight', () => {
  it('stores an integer inside the bounds and blanks 15, 45, 51 and 300', () => {
    expect(mapHeight('194', HEIGHT)).toEqual({ value: 194, records: [], flags: [] });
    expect(mapHeight('100', HEIGHT).value).toBe(100);
    expect(mapHeight('230', HEIGHT).value).toBe(230);
    for (const raw of ['15', '45', '51', '300']) {
      const result = mapHeight(raw, HEIGHT);
      expect(result.value).toBeNull();
      expect(result.records).toEqual([
        {
          field: 'height_cm',
          from: raw,
          to: null,
          ruleCode: 'IMPLAUSIBLE_TO_NULL',
          detail: { bounds: HEIGHT },
        },
      ]);
    }
  });
  it('blanks a non-integer such as 1.75 with NON_NUMERIC_TO_NULL', () => {
    expect(mapHeight('1.75', HEIGHT).records[0]?.ruleCode).toBe('NON_NUMERIC_TO_NULL');
  });
});

describe('mapAlcoholUnits', () => {
  it('stores integers, empty as null without a record, n.v.t. as null with a record', () => {
    expect(mapAlcoholUnits('10')).toEqual({ value: 10, records: [], flags: [] });
    expect(mapAlcoholUnits('0').value).toBe(0);
    expect(mapAlcoholUnits('')).toEqual({ value: null, records: [], flags: [] });
    expect(mapAlcoholUnits('n.v.t.')).toEqual({
      value: null,
      records: [
        { field: 'alcohol_units_week', from: 'n.v.t.', to: null, ruleCode: 'NON_NUMERIC_TO_NULL' },
      ],
      flags: [{ kind: 'non_numeric', field: 'alcohol_units_week', raw: 'n.v.t.' }],
    });
  });
});

describe('history reports', () => {
  it.each(['geen', '-', 'geen medicatie', 'n.v.t.', 'none'])(
    'medication: %s is none_reported with VOCAB_NONE_MEDICATION',
    (raw) => {
      expect(mapMedicationReport(raw)).toEqual({
        value: 'none_reported',
        records: [
          {
            field: 'medication_report',
            from: raw,
            to: 'none_reported',
            ruleCode: 'VOCAB_NONE_MEDICATION',
          },
        ],
        flags: [],
      });
    },
  );
  it('medication: empty is not_answered, text is reported, both without a record', () => {
    expect(mapMedicationReport('')).toEqual({ value: 'not_answered', records: [], flags: [] });
    expect(mapMedicationReport('Ozempic 0,5 mg')).toEqual({
      value: 'reported',
      records: [],
      flags: [],
    });
    expect(mapMedicationReport('Geen')).toEqual({ value: 'reported', records: [], flags: [] });
  });
  it('conditions: none and geen are none_reported; `-` is not in the condition table', () => {
    expect(mapConditionReport('geen').records[0]?.ruleCode).toBe('VOCAB_NONE_CONDITION');
    expect(mapConditionReport('none').value).toBe('none_reported');
    expect(mapConditionReport('-').value).toBe('reported');
    expect(mapConditionReport('').value).toBe('not_answered');
  });
});
