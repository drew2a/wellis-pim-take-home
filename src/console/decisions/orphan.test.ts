// Pure: what a reviewer's answer on an orphan intake means, without a database.
import { describe, expect, it } from 'vitest';

import { decideOrphan, orphanRequestSchema } from './orphan';
import { DecisionError } from './types';

const PATIENT = '11111111-1111-4111-8111-111111111111';
const INTAKE = '22222222-2222-4222-8222-222222222222';

const item = (intakeId: string | null): Parameters<typeof decideOrphan>[0] =>
  ({ id: 'item-1', intakeId }) as Parameters<typeof decideOrphan>[0];

const attach = (overrides: Record<string, unknown> = {}) =>
  orphanRequestSchema.parse({
    action: 'attach',
    note: 'same height and weight; confirmed by phone',
    patientId: PATIENT,
    ...overrides,
  });

describe('the request an orphan accepts', () => {
  it('needs a note on either answer', () => {
    expect(() => attach({ note: '' })).toThrow();
    expect(() => orphanRequestSchema.parse({ action: 'leave_unresolved', note: ' ' })).toThrow();
  });

  // There is no third action anywhere: the intake carries no name, no dob and no email.
  it('has no way to create a patient', () => {
    expect(() => orphanRequestSchema.parse({ action: 'create_patient', note: 'x' })).toThrow();
  });
});

describe('attaching', () => {
  it('writes the patient onto the intake and nothing else', () => {
    const decision = decideOrphan(item(INTAKE), attach(), true);
    expect(decision).toMatchObject({ outcome: 'resolved' });
    expect(decision.changes).toEqual([
      { entityType: 'intake', entityId: INTAKE, field: 'patient_id', value: PATIENT },
    ]);
  });

  it('refuses a patient that does not exist', () => {
    expect(() => decideOrphan(item(INTAKE), attach(), false)).toThrow(DecisionError);
  });

  it('refuses an item that names no intake', () => {
    expect(() => decideOrphan(item(null), attach(), true)).toThrow(/names no intake/);
  });
});

describe('leaving it unresolved', () => {
  it('is an acceptable outcome, recorded and changing nothing', () => {
    const decision = decideOrphan(
      item(INTAKE),
      orphanRequestSchema.parse({ action: 'leave_unresolved', note: 'no candidate is close' }),
      true,
    );
    expect(decision).toMatchObject({ outcome: 'dismissed', changes: [] });
  });
});
