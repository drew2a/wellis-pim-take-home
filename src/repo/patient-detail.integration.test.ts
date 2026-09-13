// The patient's page (R-C9). Tested against the repository rather than by rendering: what has to
// be right is which records belong to this patient and what the timeline holds.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  auditEntries,
  consentEvents,
  importRuns,
  intakes,
  legacyPatientsRaw,
  normalisationRecords,
  patientLegacyIds,
  patients,
  reviewItems,
} from '@/db/schema';
import { createTestDatabase, type TestDatabase, type TestDb } from '@/test/database';
import * as rows from '@/test/rows';

import { mergePatients } from './merge';
import { patientDetail } from './patient-detail';

let database: TestDatabase;
let db: TestDb;
let runId: number;

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
  const [run] = await db
    .insert(importRuns)
    .values(rows.importRunRow())
    .returning({ id: importRuns.id });
  runId = run?.id ?? 0;
});

async function patient(legacyId: string, name: string): Promise<string> {
  const [row] = await db
    .insert(patients)
    .values({ ...rows.patientRow(), fullName: name, createdFromLegacyId: legacyId })
    .returning({ id: patients.id });
  const id = row?.id ?? '';
  await db.insert(patientLegacyIds).values({ legacyId, patientId: id });
  return id;
}

async function intake(patientId: string, intakeId: string): Promise<string> {
  const [row] = await db
    .insert(intakes)
    .values({ ...rows.intakeRow(intakeId), patientId, createdByRun: runId })
    .returning({ id: intakes.id });
  return row?.id ?? '';
}

describe('what belongs to a patient', () => {
  // ADR-0008 item 2: a merge moves no row, so only membership answers this.
  it('includes the intakes and consent events of a record merged into it', async () => {
    const survivor = await patient('recS', 'Bram Nair');
    const loser = await patient('recL', 'Braam Nair');
    await intake(survivor, 'INT-0001');
    await intake(loser, 'INT-0002');
    await db.insert(consentEvents).values({
      patientId: loser,
      type: 'data_processing',
      action: 'granted',
      at: new Date('2025-01-01T09:00:00Z'),
    });
    await mergePatients(db, {
      survivorId: survivor,
      loserId: loser,
      actor: 'Sanne Bakker',
      reason: 'the same person',
      declaredConsentTypes: ['data_processing'],
    });

    const detail = await patientDetail(db, survivor);
    expect(detail?.intakes.map((row) => row.intakeId).sort()).toEqual(['INT-0001', 'INT-0002']);
    expect(detail?.consentEvents).toHaveLength(1);
    expect(detail?.mergedAway.map((row) => row.name)).toEqual(['Braam Nair']);
    // Both legacy ids resolve here now, which is what the merge repointed.
    expect([...(detail?.legacyIds ?? [])].sort()).toEqual(['recL', 'recS']);
  });

  it('shows a merged-away record as merged away, and points at the survivor', async () => {
    const survivor = await patient('recS', 'Bram Nair');
    const loser = await patient('recL', 'Braam Nair');
    await mergePatients(db, {
      survivorId: survivor,
      loserId: loser,
      actor: 'Sanne Bakker',
      reason: 'the same person',
      declaredConsentTypes: ['data_processing'],
    });
    expect((await patientDetail(db, loser))?.survivorOfMerge).toBe(survivor);
  });

  it('is null for a patient that does not exist', async () => {
    await expect(patientDetail(db, '00000000-0000-4000-8000-000000000000')).resolves.toBeNull();
  });

  it('masks the bsn and never returns the digits', async () => {
    const id = await patient('recS', 'Bram Nair');
    await db
      .update(patients)
      .set({ bsn: '111222333', bsnCheck: 'valid' })
      .where(eq(patients.id, id));
    const detail = await patientDetail(db, id);
    expect(detail?.maskedBsn).toBe('******333');
  });
});

describe('the timeline', () => {
  it('holds the audit entries and the normalisation records together, newest first', async () => {
    const id = await patient('recS', 'Bram Nair');
    const intakeId = await intake(id, 'INT-0001');

    await db.insert(normalisationRecords).values({
      ...rows.normalisationRecordRow(),
      entityId: 'recS',
      importRunId: runId,
      createdAt: new Date('2026-01-01T10:00:00Z'),
    });
    await db.insert(auditEntries).values({
      actor: 'legacy import',
      entityType: 'intake',
      entityId: intakeId,
      toState: 'legacy_pending',
      reason: 'legacy outcome',
      at: new Date('2026-02-01T10:00:00Z'),
    });

    const timeline = (await patientDetail(db, id))?.timeline ?? [];
    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toMatchObject({ kind: 'audit', actor: 'legacy import' });
    expect(timeline[1]).toMatchObject({ kind: 'normalisation', rule: 'TRIM_WHITESPACE' });
  });

  // A submit writes three entries in one transaction, and `at` is the transaction's instant.
  it('orders entries that share a timestamp by the sequence they were written in', async () => {
    const id = await patient('recS', 'Bram Nair');
    const at = new Date('2026-03-01T10:00:00Z');
    await db.insert(auditEntries).values([
      { actor: 'a', entityType: 'patient', entityId: id, reason: 'first', at },
      { actor: 'b', entityType: 'patient', entityId: id, reason: 'second', at },
    ]);
    const timeline = (await patientDetail(db, id))?.timeline ?? [];
    expect(timeline.map((entry) => entry.reason)).toEqual(['second', 'first']);
  });

  it('names the review item an entry closed', async () => {
    const id = await patient('recS', 'Bram Nair');
    const [item] = await db
      .insert(reviewItems)
      .values({ ...rows.reviewItemRow('key-1'), patientId: id, title: 'weight_kg is implausible' })
      .returning({ id: reviewItems.id });
    await db.insert(auditEntries).values({
      actor: 'Sanne Bakker',
      entityType: 'patient',
      entityId: id,
      reason: 'weighed at the clinic',
      reviewItemId: item?.id,
    });
    const timeline = (await patientDetail(db, id))?.timeline ?? [];
    expect(timeline[0]?.reviewItem).toMatchObject({ title: 'weight_kg is implausible' });
  });

  it('carries the field provenance of a merge', async () => {
    const survivor = await patient('recS', 'Bram Nair');
    const loser = await patient('recL', 'Braam Nair');
    await mergePatients(db, {
      survivorId: survivor,
      loserId: loser,
      actor: 'Sanne Bakker',
      actorReviewerId: null,
      reason: 'the same person',
      declaredConsentTypes: ['data_processing'],
      fieldDecisions: { fullName: { source: 'loser' } },
    });
    const timeline = (await patientDetail(db, survivor))?.timeline ?? [];
    const changes = timeline.flatMap((entry) => entry.changes ?? []);
    expect(changes).toContainEqual(
      expect.objectContaining({ field: 'full_name', chosen: 'loser', source_legacy_id: 'recL' }),
    );
  });
});

describe('the rows as exported', () => {
  it('are returned for every legacy id the record resolves', async () => {
    const id = await patient('rec000000000000001', 'Test Patient');
    await db.insert(legacyPatientsRaw).values(rows.legacyPatientRawRow(runId));
    const detail = await patientDetail(db, id);
    expect(detail?.rawPatients).toHaveLength(1);
    // Untrimmed, exactly as exported (R-A8).
    expect(detail?.rawPatients[0]?.fullName).toBe('Test Patient ');
  });

  // The stored row keeps the digits; the page does not. Otherwise the reveal route of ADR-0023
  // item 8 — which writes an audit entry before it answers — is a formality with the same number
  // printed further down the same screen and no record of the look.
  it('mask the bsn, like every other number the console shows', async () => {
    const id = await patient('rec000000000000001', 'Test Patient');
    await db
      .insert(legacyPatientsRaw)
      .values({ ...rows.legacyPatientRawRow(runId), bsn: '111222333' });

    const detail = await patientDetail(db, id);
    expect(detail?.rawPatients[0]?.bsn).toBe('******333');

    const [stored] = await db
      .select()
      .from(legacyPatientsRaw)
      .where(eq(legacyPatientsRaw.legacyId, 'rec000000000000001'));
    expect(stored?.bsn).toBe('111222333');
  });
});

describe('open items', () => {
  // A closed item carries who closed it and why; the database refuses one that does not.
  const item = async (patientId: string, status: 'open' | 'resolved'): Promise<void> => {
    await db.insert(reviewItems).values({
      ...rows.reviewItemRow(`key-${status}-${patientId}`),
      patientId,
      status,
      ...(status === 'open'
        ? {}
        : { resolvedBy: 'Sanne Bakker', resolvedAt: new Date(), resolutionNote: 'read the raw' }),
    });
  };

  // The section is headed "Open items" and says "Nothing open about this patient" when it is
  // empty: a closed item listed there is work a reviewer does twice.
  it('leave out the decisions already taken', async () => {
    const id = await patient('recS', 'Bram Nair');
    await item(id, 'open');
    await item(id, 'resolved');

    const detail = await patientDetail(db, id);
    expect(detail?.openItems).toHaveLength(1);
  });
});
