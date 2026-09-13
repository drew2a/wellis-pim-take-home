// The merge path of ADR-0006, through the repository: the importer's tier-1 merges and a human's
// decision in the console run the same function with a different actor. A merge writes exactly two
// things -- `merged_into` and the alias rows -- so that unmerge is its exact inverse and no
// append-only table is touched (ADR-0011 item 3).
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  auditEntries,
  consentEvents,
  consentStates,
  intakes,
  patientLegacyIds,
  patients,
  reviewers,
  type AuditChange,
} from '@/db/schema';
import { createTestDatabase, type TestDatabase } from '@/test/database';
import * as rows from '@/test/rows';

import { IMPORTER_ACTOR } from '@/import/actors';

import { membersOf } from './membership';
import { mergePatients, unmergePatient } from './merge';

const TYPES = ['data_processing'];
const REASON = 'tier-1 merge: survivor has intakes';
const REVIEWER = 'dr. reviewer';

describe('mergePatients / unmergePatient (ADR-0006)', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
    await database.migrate();
  });

  afterAll(async () => {
    await (database as TestDatabase | undefined)?.drop();
  });

  beforeEach(async () => {
    await database.truncateAll();
  });

  async function insertPatient(
    legacyId: string,
    overrides: Partial<typeof patients.$inferInsert> = {},
  ): Promise<string> {
    const [row] = await database.db
      .insert(patients)
      .values({ ...rows.patientRow(), signupDate: '2024-01-01', ...overrides })
      .returning({ id: patients.id });
    const id = (row as { id: string }).id;
    await database.db.insert(patientLegacyIds).values({ legacyId, patientId: id });
    return id;
  }

  const merge = (survivorId: string, loserId: string, actor: string = IMPORTER_ACTOR) =>
    mergePatients(database.db, {
      survivorId,
      loserId,
      actor,
      reason: REASON,
      declaredConsentTypes: TYPES,
    });

  async function aliasOf(legacyId: string): Promise<string | undefined> {
    const [row] = await database.db
      .select()
      .from(patientLegacyIds)
      .where(eq(patientLegacyIds.legacyId, legacyId));
    return row?.patientId;
  }

  /** Ordered, because two cases below read the trail as a sequence of transitions. */
  async function auditFor(patientId: string) {
    return database.db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.entityId, patientId))
      .orderBy(auditEntries.at);
  }

  it('repoints every legacy id, points the loser at the survivor and records both entities', async () => {
    const survivor = await insertPatient('recSurvivor');
    const loser = await insertPatient('recLoser');

    const result = await merge(survivor, loser);

    expect(result.merged).toBe(true);
    expect(result.repointedLegacyIds).toEqual(['recLoser']);
    expect(await aliasOf('recLoser')).toBe(survivor);
    expect(await aliasOf('recSurvivor')).toBe(survivor);
    const [loserRow] = await database.db.select().from(patients).where(eq(patients.id, loser));
    expect(loserRow?.mergedInto).toBe(survivor);
    expect((await membersOf(database.db, survivor)).sort()).toEqual([survivor, loser].sort());

    const loserAudit = await auditFor(loser);
    expect(loserAudit).toHaveLength(1);
    expect(loserAudit[0]).toMatchObject({
      actor: IMPORTER_ACTOR,
      fromState: 'independent',
      toState: 'merged',
    });
    expect(loserAudit[0]?.reason).toContain(REASON);
    expect(loserAudit[0]?.changes).toEqual([
      { field: 'merged_into', from: null, to: survivor },
      { field: 'patient_id', from: loser, to: survivor, source_legacy_id: 'recLoser' },
    ]);
    expect(await auditFor(survivor)).toHaveLength(1);
  });

  it('takes the fields the survivor does not hold, with provenance per field', async () => {
    const survivor = await insertPatient('recSurvivor', { city: null, sex: 'unknown' });
    const loser = await insertPatient('recLoser', { city: 'Delft', sex: 'female' });

    const result = await merge(survivor, loser);

    // In the declared field order, so that two runs produce the same `changes` array.
    expect(result.gained).toEqual([
      { field: 'sex', from: 'unknown', to: 'female', source_legacy_id: 'recLoser' },
      { field: 'city', from: null, to: 'Delft', source_legacy_id: 'recLoser' },
    ]);
    const [row] = await database.db.select().from(patients).where(eq(patients.id, survivor));
    expect(row).toMatchObject({ city: 'Delft', sex: 'female' });
    // The marker first, so an unmerge can find the entry that records this merge, then the
    // provenance of every field the survivor took.
    const [entry] = await auditFor(survivor);
    expect(entry?.changes).toEqual([
      { field: 'merged_from', from: null, to: loser },
      ...result.gained,
    ]);
  });

  it('never takes a field the survivor already holds, nor row provenance', async () => {
    const survivor = await insertPatient('recSurvivor', {
      city: 'Utrecht',
      source: 'website',
      signupDate: '2024-01-01',
    });
    const loser = await insertPatient('recLoser', {
      city: 'Delft',
      source: 'campaign',
      signupDate: '2023-06-01',
    });

    const result = await merge(survivor, loser);

    expect(result.gained).toEqual([]);
    const [row] = await database.db.select().from(patients).where(eq(patients.id, survivor));
    // `source` and `signup_date` describe the row, not the person (ADR-0006).
    expect(row).toMatchObject({ city: 'Utrecht', source: 'website', signupDate: '2024-01-01' });
  });

  it('recomputes the consent state over the union and leaves the loser none', async () => {
    const survivor = await insertPatient('recSurvivor');
    const loser = await insertPatient('recLoser');
    await database.db.insert(consentEvents).values([
      { ...rows.consentEventRow(), patientId: survivor, at: new Date('2024-02-01'), sourceLine: 1 },
      {
        ...rows.consentEventRow(),
        patientId: loser,
        action: 'revoked' as const,
        at: new Date('2024-03-01'),
        sourceLine: 2,
      },
    ]);

    await merge(survivor, loser);

    const states = await database.db.select().from(consentStates);
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({ patientId: survivor, state: 'revoked' });
  });

  // ADR-0012 items 1 and 2: the five fields the dedupe key is built from are byte-identical for
  // the second merge of one pair, so a second merge under the importer's key would be dropped and
  // a real transition would go unaudited (R-B20). Only a human can re-merge a pair a human
  // separated, and a human entry carries no key (ADR-0008 item 1), so the second merge keeps its
  // own rows.
  it('audits a second merge of the same pair after a reviewer took the first one back', async () => {
    const survivor = await insertPatient('recSurvivor', { city: null });
    const loser = await insertPatient('recLoser', { city: 'Delft' });
    const unmerge = () =>
      unmergePatient(database.db, {
        loserId: loser,
        actor: REVIEWER,
        reason: 'not the same person after all',
        declaredConsentTypes: TYPES,
      });
    await merge(survivor, loser);
    await unmerge();

    const again = await merge(survivor, loser, REVIEWER);

    expect(again.merged).toBe(true);
    // Merge, unmerge and merge again: three transitions on the loser, three entries.
    const entries = await auditFor(loser);
    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.toState)).toEqual(['merged', 'independent', 'merged']);
    const merges = entries.filter((entry) => entry.toState === 'merged');
    expect(merges.map((entry) => entry.actor)).toEqual([IMPORTER_ACTOR, REVIEWER]);
    // The importer's entry keeps its deterministic key; the reviewer's is a new event.
    expect(merges.map((entry) => entry.dedupeKey === null)).toEqual([false, true]);
    expect(await auditFor(survivor)).toHaveLength(3);

    // And the trail describes the merge in force: the second unmerge releases the city the second
    // merge took, rather than matching the first merge's entry.
    const released = await unmerge();
    expect(released.released).toEqual([
      { field: 'city', from: null, to: 'Delft', source_legacy_id: 'recLoser' },
    ]);
    const [survivorRow] = await database.db
      .select()
      .from(patients)
      .where(eq(patients.id, survivor));
    expect(survivorRow?.city).toBeNull();
  });

  it('is idempotent: merging the same pair again writes nothing', async () => {
    const survivor = await insertPatient('recSurvivor', { city: null });
    const loser = await insertPatient('recLoser', { city: 'Delft' });
    await merge(survivor, loser);
    const before = await database.db.select().from(auditEntries);

    const again = await merge(survivor, loser);

    expect(again.merged).toBe(false);
    expect(await database.db.select().from(auditEntries)).toHaveLength(before.length);
  });

  describe('refuses a merge it cannot undo', () => {
    // Every cycle needs a survivor that is already merged away, so refusing that one case is
    // what keeps merged_into acyclic (ADR-0011 item 5).
    it('when the survivor is itself merged away, in either direction', async () => {
      const first = await insertPatient('recFirst');
      const second = await insertPatient('recSecond');
      const other = await insertPatient('recOther');
      await merge(first, second);

      await expect(merge(second, first)).rejects.toThrow(/itself merged into/u);
      await expect(merge(second, other)).rejects.toThrow(/itself merged into/u);
    });

    it('when the loser is already merged into another patient', async () => {
      const first = await insertPatient('recFirst');
      const second = await insertPatient('recSecond');
      const third = await insertPatient('recThird');
      await merge(first, second);

      await expect(merge(third, second)).rejects.toThrow(/already merged/u);
    });
  });

  describe('unmerge', () => {
    it('restores the resolution, the gained fields and both consent states', async () => {
      const survivor = await insertPatient('recSurvivor', { city: null });
      const loser = await insertPatient('recLoser', { city: 'Delft' });
      await database.db.insert(consentEvents).values({
        ...rows.consentEventRow(),
        patientId: loser,
        action: 'revoked' as const,
        at: new Date('2024-03-01'),
        sourceLine: 1,
      });
      await merge(survivor, loser);

      const result = await unmergePatient(database.db, {
        loserId: loser,
        actor: REVIEWER,
        reason: 'not the same person after all',
        declaredConsentTypes: TYPES,
      });

      expect(result.survivorId).toBe(survivor);
      expect(await aliasOf('recLoser')).toBe(loser);
      const [loserRow] = await database.db.select().from(patients).where(eq(patients.id, loser));
      expect(loserRow?.mergedInto).toBeNull();
      const [survivorRow] = await database.db
        .select()
        .from(patients)
        .where(eq(patients.id, survivor));
      expect(survivorRow?.city).toBeNull();
      expect(await membersOf(database.db, survivor)).toEqual([survivor]);

      const states = await database.db.select().from(consentStates);
      expect(states).toHaveLength(2);
      expect(states.find((s) => s.patientId === loser)?.state).toBe('conflict');
      expect(states.find((s) => s.patientId === survivor)?.state).toBe('no_record');
    });

    it('records the reversal on both entities, with no dedupe key for a human actor', async () => {
      const survivor = await insertPatient('recSurvivor');
      const loser = await insertPatient('recLoser');
      await merge(survivor, loser);

      await unmergePatient(database.db, {
        loserId: loser,
        actor: REVIEWER,
        reason: 'not the same person after all',
        declaredConsentTypes: TYPES,
      });

      const entries = await auditFor(loser);
      expect(entries).toHaveLength(2);
      const unmerged = entries.find((entry) => entry.toState === 'independent');
      expect(unmerged).toMatchObject({ actor: REVIEWER, fromState: 'merged' });
      // Each human decision is a new event and must never collide (ADR-0008 item 1).
      expect(unmerged?.dedupeKey).toBeNull();
      expect(await auditFor(survivor)).toHaveLength(2);
    });

    // A survivor can be merged away after it absorbed someone (merge B into A, then A into C), so
    // the states belong to the end of the chain and never to a patient that no longer survives.
    it('writes the released states for the end of the survivor chain', async () => {
      const first = await insertPatient('recFirst');
      const second = await insertPatient('recSecond');
      const third = await insertPatient('recThird');
      await database.db.insert(consentEvents).values({
        ...rows.consentEventRow(),
        patientId: second,
        sourceLine: 1,
      });
      await merge(first, second);
      await merge(third, first);

      await unmergePatient(database.db, {
        loserId: second,
        actor: REVIEWER,
        reason: 'not the same person after all',
        declaredConsentTypes: TYPES,
      });

      const states = await database.db.select().from(consentStates);
      // `third` is the survivor of the chain and `second` is independent again; `first` is merged
      // away and holds none.
      expect(states.map((state) => state.patientId).sort()).toEqual([second, third].sort());
      expect(states.find((state) => state.patientId === second)?.state).toBe('granted');
      expect(states.find((state) => state.patientId === third)?.state).toBe('no_record');
    });

    it('refuses a patient that was never merged', async () => {
      const alone = await insertPatient('recAlone');

      await expect(
        unmergePatient(database.db, {
          loserId: alone,
          actor: REVIEWER,
          reason: 'nothing to undo',
          declaredConsentTypes: TYPES,
        }),
      ).rejects.toThrow(/not merged/u);
    });

    // A merge moves no row that points at a patient (ADR-0011 item 3), so there is nothing to put
    // back: the intakes and events of both sides are where they were loaded.
    it('leaves every intake and consent event where it was loaded', async () => {
      const survivor = await insertPatient('recSurvivor');
      const loser = await insertPatient('recLoser');
      await database.db
        .insert(intakes)
        .values({ ...rows.intakeRow('INT-loser'), patientId: loser });
      await database.db.insert(consentEvents).values({
        ...rows.consentEventRow(),
        patientId: loser,
        sourceLine: 1,
      });
      await merge(survivor, loser);

      const [intake] = await database.db.select().from(intakes);
      const [event] = await database.db.select().from(consentEvents);
      expect(intake?.patientId).toBe(loser);
      expect(event?.patientId).toBe(loser);
    });
  });
  // ADR-0022: a reviewer picks the survivor and, per field, the winning value or an edit (R-C5).
  // `mergePatients` on its own copies only fields the survivor does not hold, which is the tier-1
  // rule and the wrong one for two rows that contradict each other.
  describe('a reviewer’s per-field decisions', () => {
    const mergeWith = (
      survivorId: string,
      loserId: string,
      fieldDecisions: Parameters<typeof mergePatients>[1]['fieldDecisions'],
      actorReviewerId: string | null = null,
    ) =>
      mergePatients(database.db, {
        survivorId,
        loserId,
        actor: REVIEWER,
        actorReviewerId,
        reason: 'the same person, confirmed by phone',
        declaredConsentTypes: TYPES,
        fieldDecisions,
      });

    const changesOn = async (patientId: string): Promise<AuditChange[]> =>
      (await auditFor(patientId)).flatMap((entry) => entry.changes ?? []);

    it('writes the loser’s value over one the survivor already holds', async () => {
      const survivor = await insertPatient('recS', { fullName: 'Bram Nair' });
      const loser = await insertPatient('recL', { fullName: 'Braam Nair' });
      await mergeWith(survivor, loser, { fullName: { value: 'Braam Nair', source: 'loser' } });

      const [row] = await database.db.select().from(patients).where(eq(patients.id, survivor));
      expect(row?.fullName).toBe('Braam Nair');
      expect(await changesOn(survivor)).toContainEqual({
        field: 'full_name',
        from: 'Bram Nair',
        to: 'Braam Nair',
        source_legacy_id: 'recL',
        chosen: 'loser',
      });
    });

    // An edited value came from the reviewer, not from a row; naming a row would be false
    // provenance (ADR-0022 item 2).
    it('claims no source row for a value the reviewer typed', async () => {
      const survivor = await insertPatient('recS', { city: 'Utrecht' });
      const loser = await insertPatient('recL', { city: 'Delft' });
      await mergeWith(survivor, loser, { city: { value: 'Amsterdam', source: 'edited' } });

      expect(await changesOn(survivor)).toContainEqual({
        field: 'city',
        from: 'Utrecht',
        to: 'Amsterdam',
        chosen: 'edited',
      });
    });

    it('writes no change for a decision that is already the value', async () => {
      const survivor = await insertPatient('recS', { city: 'Utrecht' });
      const loser = await insertPatient('recL', { city: 'Utrecht' });
      const outcome = await mergeWith(survivor, loser, {
        city: { value: 'Utrecht', source: 'survivor' },
      });
      expect(outcome.decided).toEqual([]);
    });

    it('lets a decision win over the field the survivor would have gained', async () => {
      const survivor = await insertPatient('recS', { city: null });
      const loser = await insertPatient('recL', { city: 'Delft' });
      await mergeWith(survivor, loser, { city: { value: 'Rotterdam', source: 'edited' } });

      const [row] = await database.db.select().from(patients).where(eq(patients.id, survivor));
      expect(row?.city).toBe('Rotterdam');
      const changes = await changesOn(survivor);
      expect(changes.filter((change) => change.field === 'city')).toHaveLength(1);
    });

    it('checks a decided bsn, because nothing else will', async () => {
      const survivor = await insertPatient('recS');
      const loser = await insertPatient('recL');
      await mergeWith(survivor, loser, { bsn: { value: '111222333', source: 'loser' } });

      const [row] = await database.db.select().from(patients).where(eq(patients.id, survivor));
      expect(row).toMatchObject({ bsn: '111222333', bsnCheck: 'valid' });
      // Masked in the entry, like every other bsn in a jsonb column (`./mask.ts`).
      expect(await changesOn(survivor)).toContainEqual(
        expect.objectContaining({ field: 'bsn', to: '******333' }),
      );
    });

    it('refuses a field that is not a field of the person', async () => {
      const survivor = await insertPatient('recS');
      const loser = await insertPatient('recL');
      await expect(
        mergeWith(survivor, loser, { mergedInto: { value: survivor, source: 'edited' } } as never),
      ).rejects.toThrow(/mergedInto/);
    });

    it('refuses a value the column cannot hold, and writes nothing at all', async () => {
      const survivor = await insertPatient('recS', { fullName: 'Bram Nair' });
      const loser = await insertPatient('recL');
      await expect(
        mergeWith(survivor, loser, { dob: { value: '2023-02-30', source: 'edited' } }),
      ).rejects.toThrow(/dob/);

      const [row] = await database.db.select().from(patients).where(eq(patients.id, loser));
      expect(row?.mergedInto).toBeNull();
      expect(await auditFor(survivor)).toEqual([]);
    });

    it('names the reviewer behind a human merge on both entries', async () => {
      const [reviewer] = await database.db
        .insert(reviewers)
        .values({ name: REVIEWER, role: 'ops' })
        .returning({ id: reviewers.id });
      const survivor = await insertPatient('recS');
      const loser = await insertPatient('recL');
      await mergeWith(survivor, loser, {}, reviewer?.id ?? null);

      for (const id of [survivor, loser]) {
        expect((await auditFor(id))[0]?.actorReviewerId).toBe(reviewer?.id);
      }
    });

    it('leaves actor_reviewer_id null for the importer', async () => {
      const survivor = await insertPatient('recS');
      const loser = await insertPatient('recL');
      await merge(survivor, loser);
      expect((await auditFor(survivor))[0]?.actorReviewerId).toBeNull();
    });

    // Without this an unmerge would blank a value the survivor had all along.
    it('gives a chosen value back on unmerge', async () => {
      const survivor = await insertPatient('recS', { city: 'Utrecht' });
      const loser = await insertPatient('recL', { city: 'Delft' });
      await mergeWith(survivor, loser, { city: { value: 'Delft', source: 'loser' } });
      await unmergePatient(database.db, {
        loserId: loser,
        actor: REVIEWER,
        reason: 'not the same person after all',
        declaredConsentTypes: TYPES,
      });

      const [row] = await database.db.select().from(patients).where(eq(patients.id, survivor));
      expect(row?.city).toBe('Utrecht');
    });

    // The four writes and the consent recomputation are one fact, so a failure after the first of
    // them must leave none of them (ADR-0022 item 4). A review item id that does not exist fails
    // the audit insert, which happens after both patient updates.
    it('writes nothing when the merge fails after it has started', async () => {
      const survivor = await insertPatient('recS', { city: null });
      const loser = await insertPatient('recL', { city: 'Delft' });
      await expect(
        mergePatients(database.db, {
          survivorId: survivor,
          loserId: loser,
          actor: REVIEWER,
          reason: 'the same person',
          declaredConsentTypes: TYPES,
          reviewItemId: '00000000-0000-4000-8000-000000000000',
        }),
      ).rejects.toThrow();

      const [survivorRow] = await database.db
        .select()
        .from(patients)
        .where(eq(patients.id, survivor));
      const [loserRow] = await database.db.select().from(patients).where(eq(patients.id, loser));
      expect(survivorRow?.city).toBeNull();
      expect(loserRow?.mergedInto).toBeNull();
      expect(await aliasOf('recL')).toBe(loser);
      expect(await auditFor(survivor)).toEqual([]);
    });

    // The documented limit: a chosen bsn is masked in the record, so unmerge blanks it rather than
    // writing back digits it does not have. The raw row still holds the number.
    it('blanks a chosen bsn on unmerge rather than restoring a masked one', async () => {
      const survivor = await insertPatient('recS', { bsn: '111222333', bsnCheck: 'valid' });
      const loser = await insertPatient('recL');
      await mergeWith(survivor, loser, { bsn: { value: '123456782', source: 'edited' } });
      await unmergePatient(database.db, {
        loserId: loser,
        actor: REVIEWER,
        reason: 'not the same person after all',
        declaredConsentTypes: TYPES,
      });

      const [row] = await database.db.select().from(patients).where(eq(patients.id, survivor));
      expect(row).toMatchObject({ bsn: null, bsnCheck: 'absent' });
    });
  });
});
