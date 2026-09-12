// A patient's records are its own and those of every patient merged into it, transitively
// (ADR-0008 item 2). Nothing else may answer that question: `consent_events.patient_id` can never
// be repointed (ADR-0007) and a new-flow row has no legacy id, so neither the copied column nor
// the alias table can stand in for this function.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { consentEvents, eligibilityEvaluations, intakes, patients } from '@/db/schema';
import { createTestDatabase, type TestDatabase } from '@/test/database';
import * as rows from '@/test/rows';

import {
  consentEventsOf,
  evaluationsOf,
  intakesOf,
  membersOf,
  membershipBySurvivor,
  survivorOf,
} from './membership';

describe('patient membership (ADR-0008 item 2)', () => {
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

  async function insertPatient(fullName: string): Promise<string> {
    const [row] = await database.db
      .insert(patients)
      .values({ ...rows.patientRow(), fullName })
      .returning({ id: patients.id });
    return (row as { id: string }).id;
  }

  async function insertIntake(intakeId: string, patientId: string | null): Promise<string> {
    const [row] = await database.db
      .insert(intakes)
      .values({ ...rows.intakeRow(intakeId), patientId })
      .returning({ id: intakes.id });
    return (row as { id: string }).id;
  }

  async function mergeInto(loser: string, survivor: string): Promise<void> {
    await database.db.update(patients).set({ mergedInto: survivor }).where(eq(patients.id, loser));
  }

  it('returns the patient itself when nothing was merged into it', async () => {
    const alone = await insertPatient('Alone');

    expect(await membersOf(database.db, alone)).toEqual([alone]);
    expect(await survivorOf(database.db, alone)).toBe(alone);
  });

  it("returns a merged patient's intakes and consent events, new-flow events included", async () => {
    const survivor = await insertPatient('Survivor');
    const loser = await insertPatient('Loser');
    await insertIntake('INT-survivor', survivor);
    await insertIntake('INT-loser', loser);
    await database.db.insert(consentEvents).values([
      // The loser's legacy event: it keeps the patient it was loaded against (ADR-0011 item 3).
      { ...rows.consentEventRow(), patientId: loser, legacyPatientId: 'recLoser', sourceLine: 1 },
      // A new-flow event: no legacy id, so the alias table could never reach it (ADR-0008).
      { ...rows.consentEventRow(), patientId: loser, action: 'revoked' as const },
    ]);

    await mergeInto(loser, survivor);

    expect((await membersOf(database.db, survivor)).sort()).toEqual([survivor, loser].sort());
    const intakeIds = (await intakesOf(database.db, survivor)).map((i) => i.intakeId).sort();
    expect(intakeIds).toEqual(['INT-loser', 'INT-survivor']);
    const events = await consentEventsOf(database.db, survivor);
    expect(events).toHaveLength(2);
    expect(events.filter((e) => e.legacyPatientId === null)).toHaveLength(1);
  });

  it("does not give a merged-away patient the survivor's records", async () => {
    const survivor = await insertPatient('Survivor');
    const loser = await insertPatient('Loser');
    await insertIntake('INT-survivor', survivor);
    await insertIntake('INT-loser', loser);

    await mergeInto(loser, survivor);

    expect(await membersOf(database.db, loser)).toEqual([loser]);
    expect((await intakesOf(database.db, loser)).map((i) => i.intakeId)).toEqual(['INT-loser']);
  });

  it('follows merged_into transitively and resolves the survivor from any member', async () => {
    const survivor = await insertPatient('Survivor');
    const middle = await insertPatient('Middle');
    const deepest = await insertPatient('Deepest');

    await mergeInto(middle, survivor);
    await mergeInto(deepest, middle);

    expect((await membersOf(database.db, survivor)).sort()).toEqual(
      [survivor, middle, deepest].sort(),
    );
    expect(await survivorOf(database.db, deepest)).toBe(survivor);
    expect(await survivorOf(database.db, middle)).toBe(survivor);
    expect(await survivorOf(database.db, survivor)).toBe(survivor);
  });

  it("returns the evaluations of every member's intakes", async () => {
    const survivor = await insertPatient('Survivor');
    const loser = await insertPatient('Loser');
    const intake = await insertIntake('INT-loser', loser);
    await database.db
      .insert(eligibilityEvaluations)
      .values(rows.eligibilityEvaluationRow(intake, { engineOutcome: 'auto_flagged' }));

    await mergeInto(loser, survivor);

    const evaluations = await evaluationsOf(database.db, survivor);
    expect(evaluations.map((e) => e.engineOutcome)).toEqual(['auto_flagged']);
  });

  it('maps every patient to exactly one survivor in one query', async () => {
    const survivor = await insertPatient('Survivor');
    const loser = await insertPatient('Loser');
    const other = await insertPatient('Other');
    await mergeInto(loser, survivor);

    const bySurvivor = await membershipBySurvivor(database.db);

    expect([...bySurvivor.keys()].sort()).toEqual([survivor, other].sort());
    expect((bySurvivor.get(survivor) ?? []).sort()).toEqual([survivor, loser].sort());
    expect(bySurvivor.get(other)).toEqual([other]);
  });

  // The database refuses a self-merge (ADR-0008 item 6) but cannot express a longer cycle as a
  // CHECK, so the readers must terminate on one and say so rather than loop or lose the rows.
  describe('a cycle in merged_into', () => {
    it('terminates, and every reader that cannot answer throws', async () => {
      const first = await insertPatient('First');
      const second = await insertPatient('Second');
      await mergeInto(first, second);
      await mergeInto(second, first);

      expect((await membersOf(database.db, first)).sort()).toEqual([first, second].sort());
      await expect(survivorOf(database.db, first)).rejects.toThrow(/cycle/u);
      await expect(membershipBySurvivor(database.db)).rejects.toThrow(/cycle/u);
    });
  });
});
