// Pure: what a reviewer's answer on one unreadable value means.
import { describe, expect, it } from 'vitest';

import {
  dataQualityRequestSchema,
  decideDataQuality,
  maskedPayload,
  proposalOf,
} from './data-quality';
import { DecisionError } from './types';

const PATIENT = '11111111-1111-4111-8111-111111111111';
const INTAKE = '22222222-2222-4222-8222-222222222222';

type Item = Parameters<typeof decideDataQuality>[0];

const item = (overrides: Partial<Item> = {}): Item =>
  ({
    id: 'item-1',
    field: 'weight_kg',
    patientId: PATIENT,
    intakeId: null,
    proposedResolution: null,
    ...overrides,
  }) as Item;

const request = (body: Record<string, unknown>) =>
  dataQualityRequestSchema.parse({ note: 'checked against the raw row', ...body });

describe('the request a data_quality item accepts', () => {
  it('needs a note on all three answers', () => {
    for (const action of ['accept_proposal', 'set_value', 'dismiss']) {
      expect(() => dataQualityRequestSchema.parse({ action, note: ' ', value: '1' })).toThrow();
    }
  });

  it('refuses a value on an action that has none', () => {
    expect(() => request({ action: 'dismiss', value: '78' })).toThrow();
  });

  it('takes an explicit null, which is a decision and not an omission', () => {
    expect(request({ action: 'set_value', value: null })).toMatchObject({ value: null });
  });
});

describe('accepting a proposal', () => {
  const proposed = item({
    proposedResolution: { field: 'weight_kg', proposed_value: '78.0', rule: 'DECIMAL_SHIFT' },
  });

  it('writes the value the detector proposed', () => {
    const decision = decideDataQuality(proposed, request({ action: 'accept_proposal' }));
    expect(decision.changes).toEqual([
      { entityType: 'patient', entityId: PATIENT, field: 'weight_kg', value: '78.0' },
    ]);
    expect(decision.outcome).toBe('resolved');
  });

  it('reads the proposal off the item', () => {
    expect(proposalOf(proposed)).toEqual({ value: '78.0', rule: 'DECIMAL_SHIFT' });
    expect(proposalOf(item())).toBeNull();
  });

  // The 17 elfproef failures carry none: there is no proposal for a number that is simply wrong.
  it('refuses when the item carries none', () => {
    expect(() => decideDataQuality(item(), request({ action: 'accept_proposal' }))).toThrow(
      DecisionError,
    );
  });
});

describe('setting a value by hand', () => {
  it('writes what the reviewer typed', () => {
    const decision = decideDataQuality(item(), request({ action: 'set_value', value: '81.4' }));
    expect(decision.changes[0]).toMatchObject({ field: 'weight_kg', value: '81.4' });
  });

  it('corrects a value on an intake when the item is about one', () => {
    const decision = decideDataQuality(
      item({ patientId: null, intakeId: INTAKE, field: 'height_cm' }),
      request({ action: 'set_value', value: '171' }),
    );
    expect(decision.changes[0]).toMatchObject({ entityType: 'intake', entityId: INTAKE });
  });

  // An absent number cannot have been checked valid or invalid (ADR-0008 item 6).
  it('carries bsn_check along with a bsn', () => {
    const decision = decideDataQuality(
      item({ field: 'bsn' }),
      request({ action: 'set_value', value: '111222333' }),
    );
    expect(decision.changes).toEqual([
      { entityType: 'patient', entityId: PATIENT, field: 'bsn', value: '111222333' },
      { entityType: 'patient', entityId: PATIENT, field: 'bsn_check', value: 'valid' },
    ]);
  });

  it('marks a bsn that fails the elfproef as invalid, rather than refusing it', () => {
    const decision = decideDataQuality(
      item({ field: 'bsn' }),
      request({ action: 'set_value', value: '111111111' }),
    );
    expect(decision.changes[1]).toMatchObject({ field: 'bsn_check', value: 'invalid' });
  });

  it('blanks a bsn and its check together', () => {
    const decision = decideDataQuality(
      item({ field: 'bsn' }),
      request({ action: 'set_value', value: null }),
    );
    expect(decision.changes[1]).toMatchObject({ field: 'bsn_check', value: 'absent' });
  });

  it('refuses an item that names no field', () => {
    expect(() =>
      decideDataQuality(item({ field: null }), request({ action: 'set_value', value: '1' })),
    ).toThrow(/no field/);
  });

  it('refuses an item that names no row', () => {
    expect(() =>
      decideDataQuality(
        item({ patientId: null, intakeId: null }),
        request({ action: 'set_value', value: '1' }),
      ),
    ).toThrow(/no row/);
  });

  // An unreadable submission date: the item names the intake **and** its patient, and only the
  // intake has the column. Correcting the patient is not a thing the server can do, and the screen
  // offered it anyway. This export raises no such item, so this test is what covers the branch
  // (ADR-0026 item 1).
  it('corrects submitted_at on the intake, though the item names a patient too', () => {
    const decision = decideDataQuality(
      item({ patientId: PATIENT, intakeId: INTAKE, field: 'submitted_at' }),
      request({ action: 'set_value', value: '2024-12-03' }),
    );
    expect(decision.changes).toEqual([
      { entityType: 'intake', entityId: INTAKE, field: 'submitted_at', value: '2024-12-03' },
    ]);
  });

  // A consent event whose timestamp could not be read was never stored, and ADR-0007 does not let
  // one be written. There is no row to correct, so the only honest answer is to dismiss.
  it('refuses to correct a consent event’s at, which no stored row holds', () => {
    expect(() =>
      decideDataQuality(
        item({ field: 'at', intakeId: null }),
        request({ action: 'set_value', value: '2024-03-01T10:00:00Z' }),
      ),
    ).toThrow(/no row/);
  });

  it('still dismisses one, which is what such an item is for', () => {
    expect(
      decideDataQuality(item({ field: 'at', intakeId: null }), request({ action: 'dismiss' })),
    ).toMatchObject({ outcome: 'dismissed', changes: [] });
  });
});

describe('leaving the value empty', () => {
  it('dismisses and writes nothing, whatever field it is about', () => {
    const decision = decideDataQuality(item({ field: null }), request({ action: 'dismiss' }));
    expect(decision).toMatchObject({ outcome: 'dismissed', changes: [] });
  });
});

// ADR-0009 item 9 stores the repeated row unmasked on purpose — it survives nowhere else — and
// makes masking it the console's job. ADR-0030 is the decision to finally do that job here.
describe('the payload a screen may show', () => {
  const REPEATED = {
    table: 'legacy_patients_raw',
    key: 'LEG-0001',
    repeated_line_no: 812,
    repeated_row: {
      legacy_id: 'LEG-0001',
      full_name: 'Luuk Dijkstra',
      email: 'luuk@example.nl',
      dob: '1981-04-02',
      bsn: '123456782',
      phone: '+31612345678',
      city: 'Utrecht',
    },
  };

  it('masks the bsn and the phone of a row that is stored nowhere else', () => {
    const row = maskedPayload(item({ payload: REPEATED })).repeated_row;

    expect(row).toMatchObject({ bsn: '******782', phone: '*********678' });
  });

  it('leaves every other column of that row as the export gave it', () => {
    const row = maskedPayload(item({ payload: REPEATED })).repeated_row;

    // The reviewer decides which of two versions of this row is right, and these are what they
    // compare. Masking them would leave nothing to decide on.
    expect(row).toMatchObject({
      legacy_id: 'LEG-0001',
      full_name: 'Luuk Dijkstra',
      email: 'luuk@example.nl',
      dob: '1981-04-02',
      city: 'Utrecht',
    });
  });

  it('does not invent a field the repeated row never had', () => {
    const payload = {
      ...REPEATED,
      repeated_row: { legacy_id: 'LEG-0001', bsn: '123456782', city: 'Utrecht' },
    };

    expect(maskedPayload(item({ payload }))).toMatchObject({
      repeated_row: { bsn: '******782' },
    });
    expect(maskedPayload(item({ payload })).repeated_row).not.toHaveProperty('phone');
  });

  it('passes every other item’s payload through untouched, already masked by the builder', () => {
    const payload = { legacy_id: 'LEG-0002', raw_masked: '******596', canonical: null };

    expect(maskedPayload(item({ payload }))).toEqual(payload);
  });

  // A payload the console cannot mask is not a payload it may show: failing to render is
  // recoverable, rendering a readable bsn is not.
  it('throws rather than render a repeated row that is not a row of strings', () => {
    expect(() => maskedPayload(item({ payload: { repeated_row: { bsn: 123456782 } } }))).toThrow();
    expect(() => maskedPayload(item({ payload: { repeated_row: 'LEG-0001,Luuk' } }))).toThrow();
  });
});
