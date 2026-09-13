// The resolution path (ADR-0005 layer 3, ADR-0023): the only way a canonical value changes after
// import. Write the value, write the audit entry with actor, note and field history, close the
// item — in one transaction, or not at all.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { auditEntries, intakes, patients, reviewItems, reviewers } from '@/db/schema';
import { humanOwnedFields } from '@/import/canonical/human-owned';
import { createTestDatabase, type TestDatabase, type TestDb } from '@/test/database';
import { intakeRow, patientRow, reviewItemRow } from '@/test/rows';

import { resolveReviewItem, type FieldChange } from './resolve';

let database: TestDatabase;
let db: TestDb;
let reviewer: { id: string; name: string };

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  await database.migrate();
}, 60_000);

afterAll(async () => {
  await database.drop();
});

beforeEach(async () => {
  await database.truncateAll();
  const [row] = await db
    .insert(reviewers)
    .values({ name: 'Sanne Bakker', role: 'ops' })
    .returning({ id: reviewers.id, name: reviewers.name });
  if (row === undefined) throw new Error('the reviewer was not seeded');
  reviewer = row;
});

async function newPatient(overrides: Partial<typeof patients.$inferInsert> = {}): Promise<string> {
  const [row] = await db
    .insert(patients)
    .values({ ...patientRow(), ...overrides })
    .returning({ id: patients.id });
  if (row === undefined) throw new Error('the patient was not created');
  return row.id;
}

async function newItem(overrides: Partial<typeof reviewItems.$inferInsert> = {}): Promise<string> {
  const [row] = await db
    .insert(reviewItems)
    .values({ ...reviewItemRow(`key-${Math.random()}`), ...overrides })
    .returning({ id: reviewItems.id });
  if (row === undefined) throw new Error('the item was not created');
  return row.id;
}

const resolve = (
  itemId: string,
  extra: {
    outcome?: 'resolved' | 'dismissed';
    note?: string;
    changes?: readonly FieldChange[];
    resolution?: unknown;
  } = {},
) =>
  resolveReviewItem(db, {
    itemId,
    reviewer,
    outcome: extra.outcome ?? 'resolved',
    note: extra.note ?? 'checked against the raw row',
    changes: extra.changes,
    resolution: extra.resolution,
  });

const entriesFor = (entityId: string) =>
  db.select().from(auditEntries).where(eq(auditEntries.entityId, entityId));

describe('a resolution is refused', () => {
  it('without a note, because a closed decision with no reason is an audit gap', async () => {
    const itemId = await newItem();
    await expect(resolve(itemId, { note: '   ' })).rejects.toThrow(/note/i);
    const [item] = await db.select().from(reviewItems).where(eq(reviewItems.id, itemId));
    expect(item?.status).toBe('open');
  });

  it('for an item that does not exist', async () => {
    await expect(resolve('00000000-0000-4000-8000-000000000000')).rejects.toThrow(/no review item/);
  });

  // R-A17: a decision a human took is not taken again by anybody, importer or reviewer.
  it('for an item that is already closed', async () => {
    const itemId = await newItem();
    await resolve(itemId);
    await expect(resolve(itemId)).rejects.toThrow(/already/);
  });

  it('for a field the console may not write', async () => {
    const patientId = await newPatient();
    const itemId = await newItem({ patientId });
    await expect(
      resolve(itemId, {
        changes: [
          { entityType: 'patient', entityId: patientId, field: 'merged_into', value: null },
        ],
      }),
    ).rejects.toThrow(/merged_into/);
  });

  it('for a value the field cannot hold, and writes nothing at all', async () => {
    const patientId = await newPatient({ heightCm: 170 });
    const itemId = await newItem({ patientId });
    await expect(
      resolve(itemId, {
        changes: [
          { entityType: 'patient', entityId: patientId, field: 'height_cm', value: 'tall' },
        ],
      }),
    ).rejects.toThrow(/height_cm/);
    const [patient] = await db.select().from(patients).where(eq(patients.id, patientId));
    expect(patient?.heightCm).toBe(170);
    expect(await entriesFor(patientId)).toHaveLength(0);
  });

  it('for an entity that does not exist', async () => {
    const itemId = await newItem();
    await expect(
      resolve(itemId, {
        changes: [
          {
            entityType: 'patient',
            entityId: '00000000-0000-4000-8000-000000000000',
            field: 'city',
            value: 'Utrecht',
          },
        ],
      }),
    ).rejects.toThrow(/patient/);
  });
});

describe('a decision that changes nothing', () => {
  it('still closes the item and still records who decided and why', async () => {
    const patientId = await newPatient();
    const itemId = await newItem({ patientId });
    await resolve(itemId, { outcome: 'dismissed', note: 'not the same person' });

    const [item] = await db.select().from(reviewItems).where(eq(reviewItems.id, itemId));
    expect(item).toMatchObject({
      status: 'dismissed',
      resolvedBy: 'Sanne Bakker',
      resolutionNote: 'not the same person',
    });
    expect(item?.resolvedAt).not.toBeNull();

    const entries = await entriesFor(patientId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actor: 'Sanne Bakker',
      actorReviewerId: reviewer.id,
      entityType: 'patient',
      reason: 'not the same person',
      reviewItemId: itemId,
      fromState: null,
      toState: null,
      // Each human decision is a new event and must never collide with another (ADR-0008 item 1).
      dedupeKey: null,
    });
  });

  it('records it against the intake when the item is about one', async () => {
    const [intake] = await db.insert(intakes).values(intakeRow()).returning({ id: intakes.id });
    const intakeId = intake?.id ?? '';
    const itemId = await newItem({ intakeId, type: 'clinical_history' });
    await resolve(itemId, { note: 'patient contacted, care plan adjusted' });
    const entries = await entriesFor(intakeId);
    expect(entries).toHaveLength(1);
    // The historical outcome never changes: something happened, nothing transitioned.
    expect(entries[0]).toMatchObject({ entityType: 'intake', fromState: null, toState: null });
    const [row] = await db.select().from(intakes).where(eq(intakes.id, intakeId));
    expect(row).toMatchObject({ state: 'legacy_pending', outcome: 'unknown' });
  });

  it('records it against the item itself when the item is about no one row', async () => {
    const itemId = await newItem({ type: 'vocabulary', scope: 'vocabulary' });
    await resolve(itemId, { note: 'confirmed: dash is D-M-Y' });
    const entries = await entriesFor(itemId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ entityType: 'review_item', reviewItemId: itemId });
  });
});

describe('a decision that changes a value', () => {
  it('writes the value and the field history together', async () => {
    const patientId = await newPatient({ weightKg: null });
    const itemId = await newItem({ patientId, field: 'weight_kg' });
    await resolve(itemId, {
      note: 'decimal shift: 7.8 is 78',
      changes: [{ entityType: 'patient', entityId: patientId, field: 'weight_kg', value: '78.0' }],
      resolution: { action: 'accept_proposal' },
    });

    const [patient] = await db.select().from(patients).where(eq(patients.id, patientId));
    expect(patient?.weightKg).toBe('78.0');

    const entries = await entriesFor(patientId);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.changes).toEqual([{ field: 'weight_kg', from: null, to: '78.0' }]);

    const [item] = await db.select().from(reviewItems).where(eq(reviewItems.id, itemId));
    expect(item?.resolution).toEqual({ action: 'accept_proposal' });
  });

  // One audit entry per changed row, whatever the item is (docs/console-stories.md S-5).
  it('writes one entry per row, with every field that row changed', async () => {
    const first = await newPatient({ city: 'Utrecht', heightCm: 150 });
    const second = await newPatient({ city: 'Delft' });
    const itemId = await newItem({ type: 'vocabulary', scope: 'vocabulary' });
    await resolve(itemId, {
      note: 'the 18 unit-less weights are pounds',
      changes: [
        { entityType: 'patient', entityId: first, field: 'city', value: 'Amsterdam' },
        { entityType: 'patient', entityId: first, field: 'height_cm', value: '151' },
        { entityType: 'patient', entityId: second, field: 'city', value: 'Rotterdam' },
      ],
    });
    expect(await entriesFor(first)).toHaveLength(1);
    expect(await entriesFor(second)).toHaveLength(1);
    expect((await entriesFor(first))[0]?.changes).toEqual([
      { field: 'city', from: 'Utrecht', to: 'Amsterdam' },
      { field: 'height_cm', from: '150', to: '151' },
    ]);
  });

  it('writes no change for a value that is already what was chosen', async () => {
    const patientId = await newPatient({ city: 'Utrecht' });
    const itemId = await newItem({ patientId });
    await resolve(itemId, {
      changes: [{ entityType: 'patient', entityId: patientId, field: 'city', value: 'Utrecht' }],
    });
    const entries = await entriesFor(patientId);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.changes).toBeNull();
  });

  it('blanks a value when that is the decision', async () => {
    const patientId = await newPatient({ bsn: '111222333', bsnCheck: 'invalid' });
    const itemId = await newItem({ patientId, field: 'bsn' });
    await resolve(itemId, {
      note: 'the number is not this patient’s',
      changes: [
        { entityType: 'patient', entityId: patientId, field: 'bsn', value: null },
        { entityType: 'patient', entityId: patientId, field: 'bsn_check', value: 'absent' },
      ],
    });
    const [patient] = await db.select().from(patients).where(eq(patients.id, patientId));
    expect(patient).toMatchObject({ bsn: null, bsnCheck: 'absent' });
  });

  it('attaches an orphan intake to a patient', async () => {
    const patientId = await newPatient();
    const [intake] = await db.insert(intakes).values(intakeRow()).returning({ id: intakes.id });
    const intakeId = intake?.id ?? '';
    const itemId = await newItem({ intakeId, type: 'orphan_intake', field: 'patient_id' });
    await resolve(itemId, {
      note: 'same height, weight and signup week; confirmed by phone',
      changes: [
        { entityType: 'intake', entityId: intakeId, field: 'patient_id', value: patientId },
      ],
    });
    const [row] = await db.select().from(intakes).where(eq(intakes.id, intakeId));
    expect(row?.patientId).toBe(patientId);
  });

  // What a reviewer decided is not something the next import may quietly undo (R-A17).
  it('makes the field human-owned, so the importer will not rewrite it', async () => {
    const patientId = await newPatient({ city: 'Utrecht' });
    const itemId = await newItem({ patientId });
    await resolve(itemId, {
      changes: [{ entityType: 'patient', entityId: patientId, field: 'city', value: 'Amsterdam' }],
    });
    const owned = await humanOwnedFields(db, 'patient');
    expect(owned.get(patientId)?.has('city')).toBe(true);
  });
});
