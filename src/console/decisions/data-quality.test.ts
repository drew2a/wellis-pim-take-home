// Pure: what a reviewer's answer on one unreadable value means.
import { describe, expect, it } from 'vitest';

import { dataQualityRequestSchema, decideDataQuality, proposalOf } from './data-quality';
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
});

describe('leaving the value empty', () => {
  it('dismisses and writes nothing, whatever field it is about', () => {
    const decision = decideDataQuality(item({ field: null }), request({ action: 'dismiss' }));
    expect(decision).toMatchObject({ outcome: 'dismissed', changes: [] });
  });
});
