// The detectors of ADR-0005, on synthetic rows where a boundary decides and over the whole export
// where a count is the claim. The export counts here are the ones ADR-0005 was accepted with; the
// import report reproduces them from the database.
import { describe, expect, it } from 'vitest';

import { loadRules } from '@/rules/load';

import { mapIntake } from '../mapper/intake';
import { mapPatient } from '../mapper/patient';
import { parseCsv } from '../source/csv';
import { readExportFiles } from '../source/files';
import { INTAKES_HEADER, PATIENTS_HEADER, byHeader } from '../source/layout';
import type { Ids } from '../review/mapping-items';
import {
  consentItems,
  consentTypeOf,
  futureDatedConsentItem,
  type ConsentSubject,
} from './consent';
import { duplicateIntakeItems } from './duplicate-intakes';
import { decimalShift, plausibilityItems } from './plausibility';
import { divergenceItems, lbsReconciliationItem, unitMissingItem, type WeightRow } from './weight';

const rules = loadRules();
const context = { asOf: '2026-09-08', rules };
const files = readExportFiles('legacy_export');
const rawPatients = parseCsv(files['patients.csv'].bytes, PATIENTS_HEADER).map((r) =>
  byHeader(PATIENTS_HEADER, r.fields),
);
const patients = rawPatients.map((fields) => mapPatient(fields, context));
const intakes = parseCsv(files['intakes.csv'].bytes, INTAKES_HEADER).map((r) =>
  mapIntake(byHeader(INTAKES_HEADER, r.fields), context),
);

const ids: Ids = {
  patients: new Map(patients.map((p) => [p.legacyId, `uuid-${p.legacyId}`])),
  intakes: new Map(intakes.map((i) => [i.intakeId, `uuid-${i.intakeId}`])),
};

const weightRows: WeightRow[] = patients.map((patient, index) => ({
  legacyId: patient.legacyId,
  rawWeight: (rawPatients[index] as { weight: string }).weight,
  rawUnit: (rawPatients[index] as { weight_unit: string }).weight_unit,
  weightKg: patient.canonical.weightKg,
  heightCm: patient.canonical.heightCm,
  intakes: intakes
    .filter((intake) => intake.legacyPatientId === patient.legacyId)
    .map((intake) => ({ intakeId: intake.intakeId, weightKg: intake.canonical.weightKg })),
}));

describe('decimalShift (ADR-0005)', () => {
  const weight = rules.plausibility.weight_kg;
  const height = rules.plausibility.height_cm;

  it('proposes the single reading that lands inside the bounds', () => {
    expect(decimalShift(15, height)).toBe(150);
    expect(decimalShift(7.8, weight)).toBeCloseTo(78);
  });

  it('proposes nothing when two readings land', () => {
    // ×10 is 30 and ×100 is 300: both are inside [30, 300], so neither is the answer.
    expect(decimalShift(3, weight)).toBeNull();
  });

  it('proposes nothing when none lands', () => {
    expect(decimalShift(45, height)).toBeNull();
    expect(decimalShift(500, weight)).toBeNull();
  });
});

describe('the plausibility detector over this export', () => {
  const items = plausibilityItems({ patients, intakes, bounds: rules.plausibility }, ids);

  // ADR-0005: 10 per-patient items covering 5 + 5 patient values and 6 + 6 intake values.
  it("raises one item per patient and field, covering that patient's intake values too", () => {
    expect(items).toHaveLength(10);
    const values = items.flatMap((item) => (item.payload as { values: unknown[] }).values);
    expect(values).toHaveLength(5 + 5 + 6 + 6);

    const byField = items.map((item) => item.field).sort();
    expect(byField.filter((field) => field === 'weight_kg')).toHaveLength(5);
    expect(byField.filter((field) => field === 'height_cm')).toHaveLength(5);
  });

  it('closes the debt of ADR-0009 item 2: every nulled value has an item', () => {
    const nulled = [
      ...patients.flatMap((p) => p.flags.map((f) => ({ id: p.legacyId, flag: f }))),
      ...intakes.flatMap((i) => i.flags.map((f) => ({ id: i.intakeId, flag: f }))),
    ].filter(({ flag }) => flag.kind === 'implausible');
    const covered = new Set(
      items.flatMap((item) =>
        (item.payload as { values: { id: string }[] }).values.map((value) => value.id),
      ),
    );

    expect(nulled.length).toBe(22);
    expect(nulled.every(({ id }) => covered.has(id))).toBe(true);
  });

  it('every item is a row item on data_quality, keyed by patient and field', () => {
    expect(new Set(items.map((item) => `${item.type}/${item.scope}`))).toEqual(
      new Set(['data_quality/row']),
    );
    expect(new Set(items.map((item) => item.dedupeKey)).size).toBe(items.length);
  });
});

describe('the plausibility detector on synthetic rows', () => {
  const bounds = rules.plausibility;
  const patient = (legacyId: string, weight: string) =>
    mapPatient(
      {
        legacy_id: legacyId,
        full_name: 'Test Patient',
        email: '',
        dob: '1980-01-01',
        sex: 'f',
        bsn: '',
        phone: '',
        city: '',
        weight,
        weight_unit: 'kg',
        height_cm: '170',
        status: 'active',
        signup_date: '2024-01-01',
        source: '',
      },
      context,
    );
  const intake = (intakeId: string, legacyPatientId: string, weight: string) =>
    mapIntake(
      {
        intake_id: intakeId,
        legacy_patient_id: legacyPatientId,
        submitted_at: '2024-02-01',
        questionnaire_version: 'v2',
        weight,
        height: '170',
        meds_current: '',
        conditions: '',
        alcohol_units_week: '',
        outcome: 'approved',
        reviewer_note: '',
      },
      context,
    );

  it("proposes the shift of the patient's own value and carries the intakes' in the payload", () => {
    const items = plausibilityItems(
      {
        patients: [patient('recA', '7.8')],
        intakes: [intake('INT-1', 'recA', '8.1'), intake('INT-2', 'recA', '80.0')],
        bounds,
      },
      { patients: new Map([['recA', 'uuid-A']]), intakes: new Map() },
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.proposedResolution).toMatchObject({
      field: 'weight_kg',
      proposed_value: '78.0',
    });
    expect((items[0]?.payload as { values: unknown[] }).values).toHaveLength(2);
    expect(items[0]?.patientId).toBe('uuid-A');
  });

  // ADR-0011 item 10: an orphan intake has no patient to hang the item on.
  it('gives an orphan intake its own item', () => {
    const items = plausibilityItems(
      { patients: [], intakes: [intake('INT-orphan', 'recMissing', '7.8')], bounds },
      { patients: new Map(), intakes: new Map([['INT-orphan', 'uuid-INT']]) },
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ patientId: null, intakeId: 'uuid-INT', field: 'weight_kg' });
  });
});

describe('the weight detectors over this export', () => {
  it('asks about the 18 unit-less rows once, with both readings and both BMIs', () => {
    const item = unitMissingItem(weightRows);
    const rows = (item?.payload as { rows: { as_kilograms: unknown; as_pounds: unknown }[] }).rows;

    expect(rows).toHaveLength(18);
    expect(rows[0]?.as_kilograms).toBeDefined();
    expect(rows[0]?.as_pounds).toBeDefined();
    expect(item).toMatchObject({ type: 'vocabulary', scope: 'vocabulary' });
  });

  // The mapper blanks a weight that is not a number before the missing-unit rule can run, so the
  // item must not read such a row both ways: `NaN` in a jsonb payload is a silent fallback
  // (`CLAUDE.md` §5) and asks a reviewer whether a non-number is in pounds.
  it('leaves out a unit-less row whose weight is not a number', () => {
    const unitLess = (legacyId: string, rawWeight: string): WeightRow => ({
      legacyId,
      rawWeight,
      rawUnit: '',
      weightKg: null,
      heightCm: 170,
      intakes: [],
    });

    const item = unitMissingItem([unitLess('recNumber', '82.5'), unitLess('recText', 'n.v.t.')]);
    const rows = (item?.payload as { rows: { legacy_id: string }[] }).rows;

    expect(rows.map((row) => row.legacy_id)).toEqual(['recNumber']);
    expect(JSON.stringify(item?.payload)).not.toContain('NaN');
    expect(unitMissingItem([unitLess('recText', 'n.v.t.')])).toBeNull();
  });

  /*
   * ADR-0005 predicts 3 kg row items here and this export produces none, because ADR-0009 item 2
   * was decided after it. The four diverging kg pairs are `rec2LxzDL6x93TyyD`/`INT-7194` (ratio
   * 0.744), `recdD2x9IV78bfJ1N`/`INT-7200` (1.246), `recpwf2KUoxB269rI`/`INT-7198` (1.153) and
   * `recSZ0iXEva15I79t`/`INT-7193` (0.740) — every one of them a signup weight between 6.5 and
   * 7.8 kg against an intake weight between 5.7 and 8.3 kg. The mapper now nulls both ends as
   * implausible, so there is nothing left to compare, and each of those patients already carries
   * a plausibility item. Raising a divergence item as well would break `CLAUDE.md` §6: a value is
   * never both auto-fixed and flagged. Recorded as ADR-0011 item 19.
   */
  it('raises no kg row item, because the diverging weights are the implausible ones', () => {
    expect(divergenceItems(weightRows, rules, ids)).toEqual([]);

    const comparable = weightRows.filter(
      (row) =>
        row.rawUnit === 'kg' &&
        row.weightKg !== null &&
        row.intakes.some((intake) => intake.weightKg !== null),
    );
    expect(comparable).toHaveLength(1874);
  });

  // findings, weight: 49 of 68 lbs intakes leave the tolerance after conversion, and 30 of the
  // 46 comparable patients disagree with every intake of theirs, against 4 of 2688 for kg.
  it('asks about the lbs rows once, not once per row', () => {
    const item = lbsReconciliationItem(weightRows, rules, ids);
    const payload = item?.payload as {
      intakes_compared: number;
      intakes_outside: number;
      patients_compared: number;
      patients_disagreeing: number;
    };

    expect(payload).toMatchObject({
      intakes_compared: 68,
      intakes_outside: 49,
      patients_compared: 46,
      patients_disagreeing: 30,
    });
    expect(item).toMatchObject({ type: 'vocabulary', scope: 'vocabulary' });
  });

  // The headline is what a reviewer reads first, so it must count the same thing the evidence
  // below it lists: `rows` holds one entry per patient whose every intake diverges.
  it('headlines the figure its own evidence list shows', () => {
    const item = lbsReconciliationItem(weightRows, rules, ids);
    const payload = item?.payload as { rows: unknown[]; patients_compared: number };

    expect(item?.title).toBe(
      `weight_unit \`lbs\`: ${payload.rows.length} of ${payload.patients_compared} ` +
        'patients do not reconcile after conversion',
    );
    expect(payload.rows).toHaveLength(30);
  });
});

describe('the divergence tolerance', () => {
  const row = (signup: string, intake: string, unit = 'kg'): WeightRow => ({
    legacyId: 'recA',
    rawWeight: signup,
    rawUnit: unit,
    weightKg: signup,
    heightCm: 170,
    intakes: [{ intakeId: 'INT-1', weightKg: intake }],
  });
  const empty: Ids = { patients: new Map(), intakes: new Map() };

  it.each([
    ['90.0', 'inside at the lower bound'],
    ['110.0', 'inside at the upper bound'],
  ])('is inclusive: %s is %s', (intake) => {
    expect(divergenceItems([row('100.0', intake)], rules, empty)).toEqual([]);
  });

  it.each([['89.9'], ['110.1']])('reports %s, just outside', (intake) => {
    expect(divergenceItems([row('100.0', intake)], rules, empty)).toHaveLength(1);
  });

  it('says nothing when one intake of several is inside the tolerance', () => {
    const patient: WeightRow = {
      ...row('100.0', '50.0'),
      intakes: [
        { intakeId: 'INT-1', weightKg: '50.0' },
        { intakeId: 'INT-2', weightKg: '99.0' },
      ],
    };

    expect(divergenceItems([patient], rules, empty)).toEqual([]);
  });

  it('never reports an lbs row: that is one vocabulary item, not fifty (ADR-0005)', () => {
    expect(divergenceItems([row('100.0', '10.0', 'lbs')], rules, empty)).toEqual([]);
  });
});

describe('duplicate intakes over this export', () => {
  // The fifth pair is INT-7254/INT-7255, both dated 2062-01-25: the mapper nulls an impossible
  // date, but the rows still say the same day, and that is what makes them one submission twice.
  it('raises one item per same-day pair and keeps both intakes', () => {
    const items = duplicateIntakeItems(intakes, ids);

    expect(items).toHaveLength(5);
    expect(new Set(items.map((item) => `${item.type}/${item.scope}`))).toEqual(
      new Set(['duplicate_intake/row']),
    );
    expect(items.every((item) => item.proposedResolution === null)).toBe(true);
    // ADR-0006 says three pairs disagree on the outcome; by the canonical outcome the number is
    // two (INT-7254 rejected against INT-7255 pending, INT-7500 pending against INT-7498
    // approved) and by raw spelling it is four, because `afgewezen`/`rejected` and
    // `goedgekeurd`/`Approved` are one meaning in two languages. Two is what the system acts on.
    const disagreeing = items.filter(
      (item) => (item.payload as { outcomes_disagree: boolean }).outcomes_disagree,
    );
    expect(disagreeing).toHaveLength(2);
  });
});

describe('consent items (ADR-0005)', () => {
  const subject = (overrides: Partial<ConsentSubject>): ConsentSubject => ({
    legacyId: 'recA',
    patientId: 'uuid-A',
    status: 'active',
    type: 'data_processing',
    state: 'granted',
    signupDate: '2024-01-01',
    legacyIds: ['recA'],
    ...overrides,
  });

  it('raises one for every conflict, whatever the status', () => {
    const items = consentItems([
      subject({ state: 'conflict', status: 'churned' }),
      subject({ state: 'conflict', status: 'active' }),
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ type: 'consent', scope: 'row', field: 'consent_state' });
  });

  // The writer and the reader of this payload, in one test: `field` is the field the decision is
  // about, and the consent type — what `consent_states` is keyed by — is in the payload.
  it('carries the consent type where consentTypeOf reads it, not in field', () => {
    const [draft] = consentItems([subject({ state: 'conflict', type: 'data_processing' })]);

    expect(draft?.field).toBe('consent_state');
    expect(consentTypeOf({ id: 'item-1', payload: draft?.payload })).toBe('data_processing');
  });

  it('throws for an item that carries no consent type', () => {
    expect(() => consentTypeOf({ id: 'item-1', payload: {} })).toThrow(/consent type/);
  });

  it.each([
    ['revoked', 'active', true],
    ['revoked', 'paused', true],
    ['revoked', 'churned', false],
    ['no_record', 'active', true],
    ['no_record', 'prospect', false],
    ['unknown_pre_log', 'paused', true],
    ['unknown_pre_log', 'churned', false],
    ['granted', 'active', false],
  ])('%s consent on a %s patient raises an item: %s', (state, status, expected) => {
    expect(consentItems([subject({ state, status })])).toHaveLength(expected ? 1 : 0);
  });

  it('lists the future-dated events once, and changes no state', () => {
    const item = futureDatedConsentItem(
      [
        { sourceLine: 1, legacyPatientId: 'recA', action: 'revoked', at: '2031-01-01T10:00:00Z' },
        { sourceLine: 2, legacyPatientId: 'recB', action: 'granted', at: '2031-02-01T10:00:00Z' },
      ],
      '2026-09-08',
    );

    expect(item).toMatchObject({ type: 'vocabulary', scope: 'vocabulary' });
    expect(item?.payload).toMatchObject({ granted: 1, revoked: 1, as_of: '2026-09-08' });
  });

  it('raises nothing when no event is future-dated', () => {
    expect(futureDatedConsentItem([], '2026-09-08')).toBeNull();
  });
});
