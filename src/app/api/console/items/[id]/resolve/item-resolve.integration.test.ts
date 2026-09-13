// The one route every review-item action goes through (ADR-0023). Called directly with a
// `Request`, so these are the status codes a reviewer's browser gets — and the writes the database
// ends up with.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  auditEntries,
  consentEvents,
  consentStates,
  intakes,
  patientLegacyIds,
  patients,
  reviewItems,
  reviewers,
} from '@/db/schema';
import { recomputeConsentStates } from '@/consent/states';
import { loadEnv } from '@/env';
import { createTestDatabase, type TestDatabase, type TestDb } from '@/test/database';
import { intakeRow, patientRow, reviewItemRow } from '@/test/rows';

const holder = vi.hoisted((): { db: unknown } => ({ db: undefined }));
vi.mock('@/db/client', () => ({ getDb: () => holder.db }));

const SECRET = loadEnv().CONSOLE_SECRET;

const { POST: resolveItem } = await import('./route');
const { SESSION_COOKIE, signSession } = await import('@/console/session');

let database: TestDatabase;
let db: TestDb;
let reviewerId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  holder.db = db;
  await database.migrate();
}, 60_000);

afterAll(async () => {
  await database.drop();
});

beforeEach(async () => {
  await database.truncateAll();
  const [row] = await db
    .insert(reviewers)
    .values({ name: 'Sanne Bakker' })
    .returning({ id: reviewers.id });
  reviewerId = row?.id ?? '';
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const post = (id: string, body: unknown, session = true): Promise<Response> =>
  resolveItem(
    new Request(`http://localhost/api/console/items/${id}/resolve`, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: session
        ? { cookie: `${SESSION_COOKIE}=${signSession(reviewerId, new Date(), SECRET)}` }
        : {},
    }),
    params(id),
  );

async function patient(
  legacyId: string,
  weightKg: string | null,
  overrides: Partial<typeof patients.$inferInsert> = {},
): Promise<string> {
  const [row] = await db
    .insert(patients)
    .values({ ...patientRow(), createdFromLegacyId: legacyId, weightKg, ...overrides })
    .returning({ id: patients.id });
  const id = row?.id ?? '';
  // Every imported patient has one, and a merge repoints it: it is what puts source_legacy_id on
  // the field provenance (ADR-0006).
  await db.insert(patientLegacyIds).values({ legacyId, patientId: id });
  return id;
}

async function item(overrides: Partial<typeof reviewItems.$inferInsert>): Promise<string> {
  const [row] = await db
    .insert(reviewItems)
    .values({ ...reviewItemRow(`key-${Math.random()}`), ...overrides })
    .returning({ id: reviewItems.id });
  return row?.id ?? '';
}

const vocabularyItem = (rule: string, payload: unknown) =>
  item({
    type: 'vocabulary',
    scope: 'vocabulary',
    title: 'a question about the whole vocabulary',
    payload: payload,
    dedupeKey: `vocabulary|vocabulary|legacy_patient|weight_kg|${rule}|`,
  });

describe('without a session', () => {
  it('answers 401 and writes nothing', async () => {
    const id = await vocabularyItem('DATE_ORDER_FROM_SEPARATOR', {});
    const response = await post(id, { action: 'confirm', note: 'yes' }, false);
    expect(response.status).toBe(401);
    const [row] = await db.select().from(reviewItems).where(eq(reviewItems.id, id));
    expect(row?.status).toBe('open');
  });

  // The 401 comes before the body is read, so an unauthenticated caller learns nothing about what
  // the route would have accepted.
  it('answers 401 even for a body the route would refuse', async () => {
    const id = await vocabularyItem('DATE_ORDER_FROM_SEPARATOR', {});
    expect((await post(id, { nonsense: true }, false)).status).toBe(401);
  });
});

describe('resolving a vocabulary item', () => {
  it('records a confirmation against the item', async () => {
    const id = await vocabularyItem('DATE_ORDER_FROM_SEPARATOR', { evidence: {} });
    const response = await post(id, { action: 'confirm', note: '1479 values, 0 counterexamples' });
    expect(response.status).toBe(200);

    const [row] = await db.select().from(reviewItems).where(eq(reviewItems.id, id));
    expect(row).toMatchObject({
      status: 'resolved',
      resolvedBy: 'Sanne Bakker',
      resolutionNote: '1479 values, 0 counterexamples',
    });
    expect(row?.resolution).toMatchObject({ action: 'confirm' });

    const entries = await db.select().from(auditEntries).where(eq(auditEntries.entityId, id));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorReviewerId: reviewerId, entityType: 'review_item' });
  });

  it('needs a note', async () => {
    const id = await vocabularyItem('DATE_ORDER_FROM_SEPARATOR', {});
    expect((await post(id, { action: 'confirm', note: '   ' })).status).toBe(400);
  });

  it('refuses a body that names the rows to write', async () => {
    const id = await vocabularyItem('DATE_ORDER_FROM_SEPARATOR', {});
    const response = await post(id, {
      action: 'confirm',
      note: 'ok',
      changes: [{ entityType: 'patient', entityId: reviewerId, field: 'bsn', value: null }],
    });
    expect(response.status).toBe(400);
  });

  it('refuses a second decision on the same item', async () => {
    const id = await vocabularyItem('DATE_ORDER_FROM_SEPARATOR', {});
    await post(id, { action: 'confirm', note: 'yes' });
    expect((await post(id, { action: 'reject', note: 'no' })).status).toBe(409);
  });

  it('answers 404 for an item that does not exist', async () => {
    const response = await post('00000000-0000-4000-8000-000000000000', {
      action: 'confirm',
      note: 'yes',
    });
    expect(response.status).toBe(404);
  });
});

describe('applying the 18 unit-less weights', () => {
  const rows = (...legacyIds: readonly string[]) => ({
    rows: legacyIds.map((legacyId, index) => ({
      legacy_id: legacyId,
      raw_weight: '168.2',
      as_pounds: { weight_kg: `7${index}.3`, bmi: 26.1 },
      as_kilograms: { weight_kg: '168.2', bmi: 57.5 },
    })),
  });

  it('writes the pounds reading to every row, and one audit entry per row', async () => {
    const first = await patient('recA', null);
    const second = await patient('recB', null);
    const id = await vocabularyItem('WEIGHT_UNIT_MISSING_TO_NULL', rows('recA', 'recB'));

    const response = await post(id, { action: 'confirm', note: 'both reconcile with the intakes' });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ changed: 2 });

    const rowsAfter = await db.select().from(patients);
    expect(rowsAfter.map((row) => row.weightKg).sort()).toEqual(['70.3', '71.3']);
    expect(
      await db.select().from(auditEntries).where(eq(auditEntries.entityId, first)),
    ).toHaveLength(1);
    expect(
      await db.select().from(auditEntries).where(eq(auditEntries.entityId, second)),
    ).toHaveLength(1);
  });

  it('leaves out the rows the reviewer excluded', async () => {
    const kept = await patient('recA', null);
    const excluded = await patient('recB', null);
    const id = await vocabularyItem('WEIGHT_UNIT_MISSING_TO_NULL', rows('recA', 'recB'));

    await post(id, {
      action: 'confirm',
      note: 'the second does not reconcile',
      excluded: ['recB'],
    });

    const [keptRow] = await db.select().from(patients).where(eq(patients.id, kept));
    const [excludedRow] = await db.select().from(patients).where(eq(patients.id, excluded));
    expect(keptRow?.weightKg).toBe('70.3');
    expect(excludedRow?.weightKg).toBeNull();
    expect(await db.select().from(auditEntries).where(eq(auditEntries.entityId, excluded))).toEqual(
      [],
    );
  });

  it('refuses an exclusion that is not one of the item’s rows, and writes nothing', async () => {
    await patient('recA', null);
    const id = await vocabularyItem('WEIGHT_UNIT_MISSING_TO_NULL', rows('recA'));
    const response = await post(id, { action: 'confirm', note: 'ok', excluded: ['recZ'] });
    expect(response.status).toBe(400);
    const [row] = await db.select().from(patients);
    expect(row?.weightKg).toBeNull();
  });

  it('writes nothing when the answer is no', async () => {
    await patient('recA', null);
    const id = await vocabularyItem('WEIGHT_UNIT_MISSING_TO_NULL', rows('recA'));
    await post(id, { action: 'reject', note: 'they are kilograms after all' });
    const [row] = await db.select().from(patients);
    expect(row?.weightKg).toBeNull();
  });
});

describe('an item type whose screen is not built', () => {
  it('is refused rather than half-resolved', async () => {
    const id = await item({
      type: 'consent',
      field: 'consent_state',
      dedupeKey: 'consent|row|legacy_patient:recA|data_processing|CONSENT_REVOKED_WHILE_ACTIVE|x',
    });
    const response = await post(id, { action: 'confirm', note: 'ok' });
    expect(response.status).toBe(400);
    const [row] = await db.select().from(reviewItems).where(eq(reviewItems.id, id));
    expect(row?.status).toBe('open');
  });
});

describe('resolving an identity conflict', () => {
  const identityItem = (legacyIds: readonly string[]) =>
    item({
      type: 'identity_conflict',
      title: 'two patient records share a key but contradict each other',
      payload: {
        rows: legacyIds.map((legacy_id) => ({ legacy_id })),
        tier: 3,
        matched_keys: ['bsn'],
        contradictions: ['dob'],
      },
      dedupeKey: `identity_conflict|row|legacy_patient:${legacyIds.join('+')}||IDENTITY_TIER_3|bsn`,
    });

  it('merges, with the reviewer’s picks and the whole audit trail', async () => {
    const survivor = await patient('recS', null, { fullName: 'Bram Nair', city: 'Utrecht' });
    const loser = await patient('recL', null, { fullName: 'Braam Nair', city: 'Delft' });
    const id = await identityItem(['recS', 'recL']);

    const response = await post(id, {
      action: 'merge',
      note: 'one person; the spelling on the passport is Braam',
      survivorId: survivor,
      loserId: loser,
      decisions: { full_name: { source: 'loser' } },
    });
    expect(response.status).toBe(200);

    const [survivorRow] = await db.select().from(patients).where(eq(patients.id, survivor));
    const [loserRow] = await db.select().from(patients).where(eq(patients.id, loser));
    expect(survivorRow?.fullName).toBe('Braam Nair');
    expect(loserRow?.mergedInto).toBe(survivor);

    const entries = await db.select().from(auditEntries).where(eq(auditEntries.entityId, survivor));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.actorReviewerId).toBe(reviewerId);
    expect(entries[0]?.reviewItemId).toBe(id);
    expect(entries[0]?.changes).toContainEqual({
      field: 'full_name',
      from: 'Bram Nair',
      to: 'Braam Nair',
      source_legacy_id: 'recL',
      chosen: 'loser',
    });

    const [row] = await db.select().from(reviewItems).where(eq(reviewItems.id, id));
    expect(row).toMatchObject({ status: 'resolved', resolvedBy: 'Sanne Bakker' });
  });

  it('dismisses two records that are not the same person, and merges nothing', async () => {
    const first = await patient('recS', null);
    const second = await patient('recL', null);
    const id = await identityItem(['recS', 'recL']);

    const response = await post(id, {
      action: 'not_the_same_person',
      note: 'a shared household phone; different dates of birth',
    });
    expect(response.status).toBe(200);

    for (const patientId of [first, second]) {
      const [row] = await db.select().from(patients).where(eq(patients.id, patientId));
      expect(row?.mergedInto).toBeNull();
    }
    const [row] = await db.select().from(reviewItems).where(eq(reviewItems.id, id));
    expect(row?.status).toBe('dismissed');
  });

  // A uuid in a request must never be able to merge two patients that were never compared.
  it('refuses to merge a record the item does not compare', async () => {
    const survivor = await patient('recS', null);
    await patient('recL', null);
    const elsewhere = await patient('recX', null);
    const id = await identityItem(['recS', 'recL']);

    const response = await post(id, {
      action: 'merge',
      note: 'ok',
      survivorId: survivor,
      loserId: elsewhere,
    });
    expect(response.status).toBe(400);
    const [row] = await db.select().from(patients).where(eq(patients.id, elsewhere));
    expect(row?.mergedInto).toBeNull();
  });

  it('needs a note to merge', async () => {
    const survivor = await patient('recS', null);
    const loser = await patient('recL', null);
    const id = await identityItem(['recS', 'recL']);
    const response = await post(id, {
      action: 'merge',
      note: '  ',
      survivorId: survivor,
      loserId: loser,
    });
    expect(response.status).toBe(400);
  });

  // The item and the merge close together or not at all (ADR-0022 item 4).
  it('leaves the item open when the merge is refused', async () => {
    const survivor = await patient('recS', null);
    const loser = await patient('recL', null);
    const id = await identityItem(['recS', 'recL']);
    await post(id, {
      action: 'merge',
      note: 'ok',
      survivorId: survivor,
      loserId: loser,
      decisions: { dob: { source: 'edited', value: '2023-02-30' } },
    });
    const [row] = await db.select().from(reviewItems).where(eq(reviewItems.id, id));
    const [loserRow] = await db.select().from(patients).where(eq(patients.id, loser));
    expect(row?.status).toBe('open');
    expect(loserRow?.mergedInto).toBeNull();
  });
});

describe('resolving an orphan intake', () => {
  async function orphan(): Promise<{ itemId: string; intakeId: string }> {
    const [intake] = await db
      .insert(intakes)
      .values({ ...intakeRow('INT-9902'), patientId: null })
      .returning({ id: intakes.id });
    const intakeId = intake?.id ?? '';
    const itemId = await item({
      type: 'orphan_intake',
      field: 'patient_id',
      intakeId,
      title: 'intake INT-9902 references a patient that does not exist',
      payload: { look_alikes: [], legacy_patient_id: 'reccXw7xuGLe0LLnN' },
      dedupeKey: 'orphan_intake|row|legacy_intake:INT-9902|patient_id|ORPHAN|reccXw7xuGLe0LLnN',
    });
    return { itemId, intakeId };
  }

  it('attaches the intake to the patient a reviewer chose', async () => {
    const patientId = await patient('recA', null);
    const { itemId, intakeId } = await orphan();

    const response = await post(itemId, {
      action: 'attach',
      note: 'same height and weight, signed up the week before',
      patientId,
    });
    expect(response.status).toBe(200);

    const [row] = await db.select().from(intakes).where(eq(intakes.id, intakeId));
    expect(row?.patientId).toBe(patientId);
    const entries = await db.select().from(auditEntries).where(eq(auditEntries.entityId, intakeId));
    expect(entries[0]?.changes).toEqual([{ field: 'patient_id', from: null, to: patientId }]);
  });

  it('refuses a patient that does not exist, and attaches nothing', async () => {
    const { itemId, intakeId } = await orphan();
    const response = await post(itemId, {
      action: 'attach',
      note: 'ok',
      patientId: '00000000-0000-4000-8000-000000000000',
    });
    expect(response.status).toBe(400);
    const [row] = await db.select().from(intakes).where(eq(intakes.id, intakeId));
    expect(row?.patientId).toBeNull();
  });

  it('leaves it unresolved, which is an acceptable outcome', async () => {
    const { itemId, intakeId } = await orphan();
    await post(itemId, { action: 'leave_unresolved', note: 'no candidate is close enough' });

    const [row] = await db.select().from(reviewItems).where(eq(reviewItems.id, itemId));
    expect(row?.status).toBe('dismissed');
    const [intake] = await db.select().from(intakes).where(eq(intakes.id, intakeId));
    expect(intake?.patientId).toBeNull();
  });
});

describe('resolving a same-day pair', () => {
  async function pair(): Promise<{ itemId: string; ids: string[] }> {
    const ids: string[] = [];
    for (const exportedId of ['INT-8342', 'INT-8344']) {
      const [row] = await db
        .insert(intakes)
        .values({ ...intakeRow(exportedId), state: 'legacy_approved', outcome: 'approved' })
        .returning({ id: intakes.id });
      ids.push(row?.id ?? '');
    }
    const itemId = await item({
      type: 'duplicate_intake',
      title: '2 intakes from one patient on 2026-04-21',
      payload: {
        intakes: [{ intake_id: 'INT-8342' }, { intake_id: 'INT-8344' }],
        submitted_at: '2026-04-21',
      },
      dedupeKey:
        'duplicate_intake|row|legacy_patient:recF|submitted_at|SAME_DAY_INTAKES|INT-8342,INT-8344',
    });
    return { itemId, ids };
  }

  it('records the decision against both intakes and changes neither', async () => {
    const { itemId, ids } = await pair();
    const response = await post(itemId, {
      action: 'keep_one',
      note: 'the second is the visit; the first was started and abandoned',
      intakeId: 'INT-8344',
    });
    expect(response.status).toBe(200);

    for (const id of ids) {
      const entries = await db.select().from(auditEntries).where(eq(auditEntries.entityId, id));
      expect(entries).toHaveLength(1);
      // Something happened; nothing transitioned (ADR-0014 item 7).
      expect(entries[0]).toMatchObject({ fromState: null, toState: null, reviewItemId: itemId });
      const [row] = await db.select().from(intakes).where(eq(intakes.id, id));
      expect(row).toMatchObject({ state: 'legacy_approved', outcome: 'approved' });
    }

    const [row] = await db.select().from(reviewItems).where(eq(reviewItems.id, itemId));
    expect(row?.resolution).toMatchObject({ record_of_note: 'INT-8344', also_kept: ['INT-8342'] });
  });

  it('refuses an intake that is not one of the pair', async () => {
    const { itemId } = await pair();
    const response = await post(itemId, {
      action: 'keep_one',
      note: 'ok',
      intakeId: 'INT-0001',
    });
    expect(response.status).toBe(400);
  });
});

describe('resolving a data_quality item', () => {
  const weightItem = (patientId: string, proposal: unknown) =>
    item({
      type: 'data_quality',
      field: 'weight_kg',
      patientId,
      title: 'weight_kg outside the plausible range',
      payload: { raw: '7.8' },
      proposedResolution: proposal,
      dedupeKey: `data_quality|row|legacy_patient:recA|weight_kg|IMPLAUSIBLE|7.8`,
    });

  it('accepts the detector’s proposal and records the change', async () => {
    const patientId = await patient('recA', null);
    const itemId = await weightItem(patientId, {
      field: 'weight_kg',
      proposed_value: '78.0',
      rule: 'DECIMAL_SHIFT',
    });

    const response = await post(itemId, {
      action: 'accept_proposal',
      note: 'the intakes agree with 78',
    });
    expect(response.status).toBe(200);

    const [row] = await db.select().from(patients).where(eq(patients.id, patientId));
    expect(row?.weightKg).toBe('78.0');
    const entries = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.entityId, patientId));
    expect(entries[0]?.changes).toEqual([{ field: 'weight_kg', from: null, to: '78.0' }]);
  });

  it('writes a value the reviewer establishes instead', async () => {
    const patientId = await patient('recA', null);
    const itemId = await weightItem(patientId, null);
    await post(itemId, { action: 'set_value', value: '81.4', note: 'weighed at the clinic' });

    const [row] = await db.select().from(patients).where(eq(patients.id, patientId));
    expect(row?.weightKg).toBe('81.4');
  });

  it('refuses a value the column cannot hold, and writes nothing', async () => {
    const patientId = await patient('recA', null);
    const itemId = await weightItem(patientId, null);
    const response = await post(itemId, { action: 'set_value', value: 'heavy', note: 'ok' });
    expect(response.status).toBe(400);
    const refusal = (await response.json()) as { error: string };
    expect(refusal.error).toContain('weight_kg');

    const [row] = await db.select().from(patients).where(eq(patients.id, patientId));
    const [open] = await db.select().from(reviewItems).where(eq(reviewItems.id, itemId));
    expect(row?.weightKg).toBeNull();
    expect(open?.status).toBe('open');
  });

  it('writes a bsn and its check together', async () => {
    const patientId = await patient('recA', null);
    const itemId = await item({
      type: 'data_quality',
      field: 'bsn',
      patientId,
      title: 'bsn fails the elfproef',
      payload: { raw_masked: '******333' },
      dedupeKey: 'data_quality|row|legacy_patient:recA|bsn|ELFPROEF|x',
    });
    await post(itemId, { action: 'set_value', value: '111222333', note: 'read from the passport' });

    const [row] = await db.select().from(patients).where(eq(patients.id, patientId));
    expect(row).toMatchObject({ bsn: '111222333', bsnCheck: 'valid' });
  });

  it('leaves the value empty when that is the decision', async () => {
    const patientId = await patient('recA', null);
    const itemId = await weightItem(patientId, null);
    await post(itemId, { action: 'dismiss', note: 'the patient cannot be reached' });

    const [row] = await db.select().from(patients).where(eq(patients.id, patientId));
    const [closed] = await db.select().from(reviewItems).where(eq(reviewItems.id, itemId));
    expect(row?.weightKg).toBeNull();
    expect(closed?.status).toBe('dismissed');
  });

  // An unreadable submission date. The item names the intake **and** the patient, and only the
  // intake has the column: routing it to the patient made the correction impossible and answered
  // every attempt with a 400 naming a column nobody could see (ADR-0026 item 1). No item in this
  // export takes that shape, which is why nothing but this test reaches it.
  it('writes an unreadable submitted_at onto the intake the item names', async () => {
    const patientId = await patient('recA', null);
    const [intake] = await db
      .insert(intakes)
      .values({ ...intakeRow('INT-9903'), patientId, submittedAt: null })
      .returning({ id: intakes.id });
    const intakeId = intake?.id ?? '';
    const itemId = await item({
      type: 'data_quality',
      field: 'submitted_at',
      patientId,
      intakeId,
      title: 'submitted_at is not a date in a known shape',
      payload: { intake_id: 'INT-9903', raw: '32/13/2024' },
      dedupeKey: 'data_quality|row|legacy_intake:INT-9903|submitted_at|DATE_UNREADABLE_TO_NULL|x',
    });

    const response = await post(itemId, {
      action: 'set_value',
      value: '2024-12-03',
      note: 'the consent line of that day dates it',
    });
    expect(response.status).toBe(200);

    const [row] = await db.select().from(intakes).where(eq(intakes.id, intakeId));
    expect(row?.submittedAt).toBe('2024-12-03');
    const entries = await db.select().from(auditEntries).where(eq(auditEntries.entityId, intakeId));
    expect(entries[0]?.changes).toEqual([{ field: 'submitted_at', from: null, to: '2024-12-03' }]);
  });

  // A consent event whose timestamp could not be read was never stored, and ADR-0007 does not let
  // one be written. The screen offers no value form for it; the route refuses one anyway.
  it('refuses to correct a consent event’s at, and still dismisses it', async () => {
    const patientId = await patient('recA', null);
    const atItem = () =>
      item({
        type: 'data_quality',
        field: 'at',
        patientId,
        title: 'consent event time is unreadable; no event stored',
        payload: { source_line: 12, raw: 'yesterday' },
        dedupeKey: `data_quality|row|legacy_consent_event:${String(Math.random())}|at|TIMESTAMP_UNPARSED|x`,
      });

    const refused = await post(await atItem(), {
      action: 'set_value',
      value: '2024-03-01',
      note: 'read from the mailbox',
    });
    expect(refused.status).toBe(400);

    const dismissible = await atItem();
    const dismissed = await post(dismissible, {
      action: 'dismiss',
      note: 'the line cannot be dated; the raw line is kept',
    });
    expect(dismissed.status).toBe(200);
    const [closed] = await db.select().from(reviewItems).where(eq(reviewItems.id, dismissible));
    expect(closed?.status).toBe('dismissed');
  });
});

describe('resolving a consent item', () => {
  const consentItem = (patientId: string) =>
    item({
      type: 'consent',
      field: 'data_processing',
      patientId,
      title: 'consent revoked for a patient who is active',
      payload: { consent_state: 'revoked', patient_status: 'active' },
      dedupeKey: 'consent|row|legacy_patient:recA|data_processing|CONSENT_REVOKED_WHILE_ACTIVE|x',
    });

  it('records what was done outside the system, against the patient', async () => {
    const patientId = await patient('recA', null);
    const itemId = await consentItem(patientId);

    const response = await post(itemId, {
      action: 'resolve',
      note: 'patient contacted; processing paused until consent is re-obtained',
    });
    expect(response.status).toBe(200);

    const entries = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.entityId, patientId));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorReviewerId: reviewerId,
      reason: 'patient contacted; processing paused until consent is re-obtained',
      reviewItemId: itemId,
    });
  });

  // An event is what the patient did. Nothing a reviewer types becomes one (CLAUDE.md §5).
  it('writes no consent event and changes no consent state', async () => {
    const patientId = await patient('recA', null);
    const itemId = await consentItem(patientId);
    await post(itemId, { action: 'resolve', note: 'consent re-obtained on paper' });

    expect(await db.select().from(consentEvents)).toEqual([]);
    expect(await db.select().from(consentStates)).toEqual([]);
  });

  it('needs a note', async () => {
    const patientId = await patient('recA', null);
    const itemId = await consentItem(patientId);
    expect((await post(itemId, { action: 'resolve', note: '  ' })).status).toBe(400);
  });
});

// ADR-0025: the seven logs that contradict themselves, where no rule can say what is true.
describe('establishing a consent state', () => {
  async function conflicted(): Promise<{ itemId: string; patientId: string }> {
    const patientId = await patient('recA', null, { signupDate: '2025-01-01' });
    await db.insert(consentEvents).values([
      {
        patientId,
        type: 'data_processing',
        action: 'revoked',
        at: new Date('2025-02-01T10:00:00Z'),
      },
      {
        patientId,
        type: 'data_processing',
        action: 'granted',
        at: new Date('2025-02-09T10:00:00Z'),
      },
    ]);
    await recomputeConsentStates(db, { declaredTypes: ['data_processing'] });
    const itemId = await item({
      type: 'consent',
      field: 'data_processing',
      patientId,
      title: 'the consent log contradicts itself',
      payload: { consent_state: 'conflict' },
      dedupeKey: 'consent|row|legacy_patient:recA|data_processing|CONSENT_CONFLICT|conflict',
    });
    return { itemId, patientId };
  }

  it('writes the state, the audit entry and the closed item together', async () => {
    const { itemId, patientId } = await conflicted();

    const response = await post(itemId, {
      action: 'set_state',
      state: 'granted',
      note: 'reached the patient; consent given on paper on 2026-09-11',
    });
    expect(response.status).toBe(200);

    const [state] = await db
      .select()
      .from(consentStates)
      .where(eq(consentStates.patientId, patientId));
    expect(state).toMatchObject({ state: 'granted', derivationVersion: 'human' });

    const entries = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.entityId, patientId));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.changes).toEqual([
      { field: 'consent_state:data_processing', from: 'conflict', to: 'granted' },
    ]);
    expect(entries[0]?.actorReviewerId).toBe(reviewerId);

    const [row] = await db.select().from(reviewItems).where(eq(reviewItems.id, itemId));
    expect(row?.resolution).toMatchObject({ state: 'granted', was: 'conflict' });
  });

  // No consent event is ever written from this screen (CLAUDE.md §5).
  it('adds no consent event', async () => {
    const { itemId } = await conflicted();
    const before = await db.select().from(consentEvents);
    await post(itemId, { action: 'set_state', state: 'revoked', note: 'the patient confirmed' });
    expect(await db.select().from(consentEvents)).toHaveLength(before.length);
  });

  // A revocation that is unambiguous is acted on, not overridden (ADR-0025 §3).
  it('refuses a state over a log that does not contradict itself, and writes nothing', async () => {
    const patientId = await patient('recA', null, { signupDate: '2025-01-01' });
    await db.insert(consentEvents).values({
      patientId,
      type: 'data_processing',
      action: 'revoked',
      at: new Date('2025-03-02T10:00:00Z'),
    });
    // One event, and it is a revocation, so the first event is a revocation: that is a conflict by
    // ADR-0011 item 15. A grant first makes the log unambiguous.
    await db.insert(consentEvents).values({
      patientId,
      type: 'data_processing',
      action: 'granted',
      at: new Date('2025-01-05T10:00:00Z'),
    });
    await recomputeConsentStates(db, { declaredTypes: ['data_processing'] });
    const itemId = await item({
      type: 'consent',
      field: 'data_processing',
      patientId,
      title: 'consent revoked for a patient who is active',
      payload: { consent_state: 'revoked' },
      dedupeKey: 'consent|row|legacy_patient:recA|data_processing|CONSENT_REVOKED_WHILE_ACTIVE|x',
    });

    const response = await post(itemId, {
      action: 'set_state',
      state: 'granted',
      note: 'they said it was fine',
    });
    expect(response.status).toBe(400);

    const [state] = await db
      .select()
      .from(consentStates)
      .where(eq(consentStates.patientId, patientId));
    expect(state).toMatchObject({ state: 'revoked', derivationVersion: '1' });
    const [row] = await db.select().from(reviewItems).where(eq(reviewItems.id, itemId));
    expect(row?.status).toBe('open');
  });

  it('needs a note', async () => {
    const { itemId } = await conflicted();
    expect((await post(itemId, { action: 'set_state', state: 'granted', note: ' ' })).status).toBe(
      400,
    );
  });
});

describe('resolving a clinical_history item', () => {
  async function historyItem(): Promise<{ itemId: string; intakeId: string }> {
    const [intake] = await db
      .insert(intakes)
      .values({ ...intakeRow('INT-9400'), state: 'legacy_approved', outcome: 'approved' })
      .returning({ id: intakes.id });
    const intakeId = intake?.id ?? '';
    const itemId = await item({
      type: 'clinical_history',
      intakeId,
      title: 'GLP-1 medication reported in free text',
      reason: 'flagged: current GLP-1 medication (rybelsus 7 mg)',
      payload: { legacy_outcome: 'approved', shadow_outcome: 'auto_flagged' },
      dedupeKey: 'clinical_history|row|legacy_intake:INT-9400||HISTORY_GLP1_MEDICATION|v1',
    });
    return { itemId, intakeId };
  }

  // CLAUDE.md §5: detectors must not rewrite historical outcomes, and neither may a reviewer here.
  it('records what was done and leaves the legacy outcome exactly as it was', async () => {
    const { itemId, intakeId } = await historyItem();
    const response = await post(itemId, {
      action: 'resolve',
      note: 'patient contacted; already off the medication',
    });
    expect(response.status).toBe(200);

    const [row] = await db.select().from(intakes).where(eq(intakes.id, intakeId));
    expect(row).toMatchObject({ state: 'legacy_approved', outcome: 'approved' });

    const entries = await db.select().from(auditEntries).where(eq(auditEntries.entityId, intakeId));
    expect(entries).toHaveLength(1);
    // Something happened; nothing transitioned (ADR-0014 item 7).
    expect(entries[0]).toMatchObject({
      fromState: null,
      toState: null,
      actorReviewerId: reviewerId,
      reviewItemId: itemId,
    });
  });

  it('dismisses when no action is needed', async () => {
    const { itemId } = await historyItem();
    await post(itemId, { action: 'dismiss', note: 'the note already says it was discussed' });
    const [row] = await db.select().from(reviewItems).where(eq(reviewItems.id, itemId));
    expect(row?.status).toBe('dismissed');
  });

  it('needs a note', async () => {
    const { itemId } = await historyItem();
    expect((await post(itemId, { action: 'resolve', note: '' })).status).toBe(400);
  });
});
