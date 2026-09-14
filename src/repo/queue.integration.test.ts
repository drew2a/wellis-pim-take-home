// The work queue (R-C2, R-C3). Tested against the repository function rather than by rendering a
// page: the page is a renderer, and this is where the queue is decided (ADR-0024).
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  auditEntries,
  importRuns,
  intakes,
  intakeStateEnum,
  patients,
  reviewItems,
  reviewItemTypeEnum,
} from '@/db/schema';
import type { IntakeState } from '@/intake/machine';
import { createTestDatabase, type TestDatabase, type TestDb } from '@/test/database';
import { importRunRow, intakeRow, patientRow, reviewItemRow } from '@/test/rows';

import { mergePatients } from './merge';
import { DEFAULT_FILTERS, queueCounts, queuePage, type QueueFilters } from './queue';

let database: TestDatabase;
let db: TestDb;
let runId: number;

// A fixed instant, so "today" and "this week" mean the same on every machine and on every day.
const NOW = new Date('2026-09-13T12:00:00+02:00');
const TODAY = '2026-09-13';
const THIS_WEEK = '2026-09-10';
const LONG_AGO = '2024-04-12';

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
  const [run] = await db.insert(importRuns).values(importRunRow()).returning({ id: importRuns.id });
  runId = run?.id ?? 0;
});

const filters = (overrides: Partial<QueueFilters> = {}): QueueFilters => ({
  ...DEFAULT_FILTERS,
  ...overrides,
});

const rowsOf = async (overrides: Partial<QueueFilters> = {}) =>
  (await queuePage(db, filters(overrides), NOW)).rows;

async function newPatient(fullName = 'Test Patient'): Promise<string> {
  const [row] = await db
    .insert(patients)
    .values({ ...patientRow(), fullName })
    .returning({ id: patients.id });
  if (row === undefined) throw new Error('the patient was not created');
  return row.id;
}

/** A row the importer wrote: it carries a run and the day the questionnaire was submitted. */
async function legacyIntake(
  intakeId: string,
  submittedAt: string | null,
  state: IntakeState = 'legacy_pending',
  patientId: string | null = null,
): Promise<string> {
  const [row] = await db
    .insert(intakes)
    .values({ ...intakeRow(intakeId), state, submittedAt, patientId, createdByRun: runId })
    .returning({ id: intakes.id });
  if (row === undefined) throw new Error('the legacy intake was not created');
  return row.id;
}

/**
 * A row the new flow wrote: no run, no exported id, and an audit entry for the first answer
 * (ADR-0016). The state is reached by walking the machine's own edges, because the database's
 * trigger refuses an intake born anywhere but `draft` (ADR-0014 item 6).
 */
async function newFlowIntake(draftAt: Date, walk: readonly IntakeState[] = []): Promise<string> {
  const [row] = await db
    .insert(intakes)
    .values({
      medicationReport: 'not_answered',
      conditionReport: 'not_answered',
      outcome: 'pending',
      state: 'draft',
    })
    .returning({ id: intakes.id });
  const id = row?.id ?? '';
  await db.insert(auditEntries).values({
    actor: 'intake form',
    entityType: 'intake',
    entityId: id,
    toState: 'draft',
    reason: 'draft created by the intake form',
    at: draftAt,
  });
  for (const state of walk) await db.update(intakes).set({ state }).where(eq(intakes.id, id));
  return id;
}

async function item(
  overrides: Partial<typeof reviewItems.$inferInsert> = {},
  createdAt = NOW,
): Promise<string> {
  const [row] = await db
    .insert(reviewItems)
    .values({ ...reviewItemRow(`key-${Math.random()}`), createdAt, ...overrides })
    .returning({ id: reviewItems.id });
  if (row === undefined) throw new Error('the review item was not created');
  return row.id;
}

const at = (iso: string): Date => new Date(`${iso}T09:00:00+02:00`);

describe('one queue, both sources of work', () => {
  it('lists review items and intakes together, in one list', async () => {
    await item({ title: 'newest item' }, at(TODAY));
    await legacyIntake('INT-0001', LONG_AGO);
    await item({ title: 'older item' }, at(THIS_WEEK));

    const rows = await rowsOf({ states: ['legacy_pending'] });
    expect(rows.map((row) => row.title)).toEqual(['INT-0001', 'older item', 'newest item']);
    expect(rows.map((row) => row.kind)).toEqual(['intake', 'review_item', 'review_item']);
  });

  // The two sources are not equally urgent: a patient who submitted this morning is waiting for a
  // decision, a consent gap from 2023 is not. Age alone buries a new intake among hundreds of items
  // — and after a fresh import every one of those items carries the import moment as its age, so
  // age does not order them at all (`docs/reviewer-day.md`).
  it('puts the intakes waiting for a person above the review items, whatever their age', async () => {
    await item({ title: 'an item raised long ago' }, at(LONG_AGO));
    await newFlowIntake(at(TODAY), ['submitted', 'auto_flagged']);

    const rows = await queuePage(db, DEFAULT_FILTERS, NOW);
    expect(rows.rows.map((row) => row.kind)).toEqual(['intake', 'review_item']);
  });

  it('orders by age inside each group', async () => {
    await item({ title: 'newer item' }, at(TODAY));
    await item({ title: 'older item' }, at(LONG_AGO));
    await legacyIntake('INT-0002', THIS_WEEK);
    await legacyIntake('INT-0001', LONG_AGO);

    const rows = await rowsOf({ states: ['legacy_pending'] });
    expect(rows.map((row) => row.title)).toEqual([
      'INT-0001',
      'INT-0002',
      'older item',
      'newer item',
    ]);
  });

  it('says what kind of work each row is: the item type, or the intake state', async () => {
    await item({ type: 'clinical_history' });
    await legacyIntake('INT-0001', TODAY);
    const rows = await rowsOf({ states: ['legacy_pending'] });
    expect(rows.map((row) => row.type).sort()).toEqual(['clinical_history', 'legacy_pending']);
  });
});

describe('how old a row is', () => {
  // All 2917 imported audit entries share one transaction timestamp (ADR-0023 item 2).
  it('dates a legacy intake by the day its questionnaire was submitted', async () => {
    await legacyIntake('INT-0001', LONG_AGO);
    const [row] = await rowsOf({ types: [], states: ['legacy_pending'] });
    expect(row?.age?.toISOString()).toBe(new Date(`${LONG_AGO}T00:00:00+02:00`).toISOString());
  });

  it('dates a new-flow intake by its first answer', async () => {
    const draftAt = at(THIS_WEEK);
    await newFlowIntake(draftAt);
    const [row] = await rowsOf({ types: [], states: ['draft'] });
    expect(row?.age?.toISOString()).toBe(draftAt.toISOString());
  });

  // Last of its own group, not last of the queue: an intake nothing dates is still a person
  // waiting, so it keeps its place above the data to clean (`docs/reviewer-day.md`, ADR-0031).
  it('lists a row nothing dates, last of its group, rather than dropping it', async () => {
    await legacyIntake('INT-0001', null);
    await legacyIntake('INT-0002', TODAY);
    await item({ title: 'an item raised long ago' }, at(LONG_AGO));
    const rows = await rowsOf({ states: ['legacy_pending'] });
    expect(rows.map((row) => row.title)).toEqual([
      'INT-0002',
      'INT-0001',
      'an item raised long ago',
    ]);
    expect(rows[1]?.age).toBeNull();
  });
});

describe('the filters', () => {
  it('narrows to the types selected', async () => {
    await item({ type: 'consent' });
    await item({ type: 'orphan_intake' });
    const rows = await rowsOf({ types: ['consent'], states: [] });
    expect(rows.map((row) => row.type)).toEqual(['consent']);
  });

  it('narrows to the intake states selected, and shows no intake when none is', async () => {
    await legacyIntake('INT-0001', TODAY, 'legacy_approved');
    await legacyIntake('INT-0002', TODAY, 'legacy_pending');
    expect((await rowsOf({ types: [], states: ['legacy_approved'] })).map((r) => r.title)).toEqual([
      'INT-0001',
    ]);
    expect(await rowsOf({ types: [], states: [] })).toEqual([]);
  });

  it('shows open items by default and closed ones only when asked', async () => {
    await item({ title: 'still open' });
    await item({
      title: 'done',
      status: 'resolved',
      resolvedBy: 'Sanne Bakker',
      resolvedAt: NOW,
      resolutionNote: 'checked',
    });
    expect((await rowsOf({ states: [] })).map((row) => row.title)).toEqual(['still open']);
    expect((await rowsOf({ states: [], status: 'resolved' })).map((row) => row.title)).toEqual([
      'done',
    ]);
  });

  it.each([
    ['today', TODAY, ['today']],
    ['week', THIS_WEEK, ['today', 'this week']],
    ['older', LONG_AGO, ['long ago']],
  ] as const)('picks out what arrived %s', async (age, _day, expected) => {
    await item({ title: 'today' }, at(TODAY));
    await item({ title: 'this week' }, at(THIS_WEEK));
    await item({ title: 'long ago' }, at(LONG_AGO));
    const rows = await rowsOf({ states: [], age });
    expect(rows.map((row) => row.title).sort()).toEqual([...expected].sort());
  });

  // docs/reviewer-day.md: auto_cleared is "clear for doctor review" and auto_rejected that nobody
  // opens is a machine deciding alone, so both are in the view a reviewer works. A draft nobody has
  // submitted and the 2917 legacy rows are not, and are one filter click away.
  it('opens on the open items and the intakes waiting for a person', async () => {
    await item({ title: 'an item' });
    await newFlowIntake(at(TODAY), ['submitted', 'auto_flagged']);
    await newFlowIntake(at(TODAY), ['submitted', 'auto_cleared']);
    await newFlowIntake(at(TODAY), ['submitted', 'auto_rejected']);
    await newFlowIntake(at(TODAY)); // still a draft
    await legacyIntake('INT-0001', TODAY, 'legacy_approved');
    const rows = await queuePage(db, DEFAULT_FILTERS, NOW);
    expect(rows.rows.map((row) => row.type).sort()).toEqual([
      'auto_cleared',
      'auto_flagged',
      'auto_rejected',
      'data_quality',
    ]);
  });

  it('stops at the limit and says there is more', async () => {
    await item({ title: 'one' }, at(LONG_AGO));
    await item({ title: 'two' }, at(THIS_WEEK));
    const page = await queuePage(db, filters({ states: [], limit: 1 }), NOW);
    expect(page.rows.map((row) => row.title)).toEqual(['one']);
    expect(page.more).toBe(true);
  });
});

describe('the patient a row is about', () => {
  it('is the surviving record, not the row that was merged away', async () => {
    const survivor = await newPatient('Bram Nair');
    const loser = await newPatient('Braam Nair');
    await item({ patientId: loser });
    await mergePatients(db, {
      survivorId: survivor,
      loserId: loser,
      actor: 'Sanne Bakker',
      reason: 'the same person',
      declaredConsentTypes: ['data_processing'],
    });
    const [row] = await rowsOf({ states: [] });
    expect(row).toMatchObject({ patientId: survivor, patientName: 'Bram Nair' });
  });

  it('is empty for work about no patient at all', async () => {
    await item({ type: 'vocabulary', scope: 'vocabulary' });
    const [row] = await rowsOf({ states: [] });
    expect(row).toMatchObject({ patientId: null, patientName: null });
  });
});

describe('the counts', () => {
  // Every enum value is a filter, so every enum value is a key: a missing one would quietly drop a
  // filter from the screen (ADR-0023 item 1).
  it('cover every review item type and every intake state, with zeros', async () => {
    const counts = await queueCounts(db);
    expect(Object.keys(counts.items).sort()).toEqual([...reviewItemTypeEnum.enumValues].sort());
    expect(Object.keys(counts.intakes).sort()).toEqual([...intakeStateEnum.enumValues].sort());
    expect(Object.values(counts.items).every((n) => n === 0)).toBe(true);
  });

  it('count the database and not the page', async () => {
    await item({ type: 'consent' }, at(LONG_AGO));
    await item({ type: 'consent' }, at(THIS_WEEK));
    await legacyIntake('INT-0001', TODAY, 'legacy_approved');
    const page = await queuePage(db, filters({ limit: 1 }), NOW);
    const counts = await queueCounts(db);
    expect(page.rows).toHaveLength(1);
    expect(counts.items.consent).toBe(2);
    expect(counts.intakes.legacy_approved).toBe(1);
  });

  it('count items by the status being looked at', async () => {
    await item({ type: 'consent' });
    await item({
      type: 'consent',
      status: 'dismissed',
      resolvedBy: 'Sanne Bakker',
      resolvedAt: NOW,
      resolutionNote: 'no',
    });
    expect((await queueCounts(db)).items.consent).toBe(1);
    expect((await queueCounts(db, 'dismissed')).items.consent).toBe(1);
  });
});
