// The importer's tier-1 merges against a real database, for the one case the pure candidate tests
// cannot reach: what happens on the run after a reviewer disagreed with a merge (ADR-0012 item 2).
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { patientLegacyIds, patients } from '@/db/schema';
import { unmergePatient } from '@/repo/merge';
import { createTestDatabase, type TestDatabase } from '@/test/database';
import * as rows from '@/test/rows';

import { humanOwnedFields } from '../canonical/human-owned';
import type { CandidateGroup, IdentityRow } from './candidates';
import { mergeTier1Groups } from './merge-tier1';

const TYPES = ['data_processing'];

/** Two rows identical on every person field, which is what makes a group tier 1 (ADR-0006). */
function identityRow(legacyId: string, overrides: Partial<IdentityRow> = {}): IdentityRow {
  return {
    legacyId,
    fullName: 'Sanne de Vries',
    dob: '1990-02-01',
    email: 'sanne@example.com',
    bsn: null,
    phone: null,
    sex: 'female',
    city: 'Utrecht',
    weightKg: null,
    heightCm: null,
    status: 'active',
    signupDate: '2024-01-01',
    source: 'website',
    intakeCount: 0,
    ...overrides,
  };
}

describe('mergeTier1Groups over a decision a human already took', () => {
  let database: TestDatabase;
  let survivorId: string;
  let loserId: string;
  let group: CandidateGroup;

  beforeAll(async () => {
    database = await createTestDatabase();
    await database.migrate();
  });

  afterAll(async () => {
    await (database as TestDatabase | undefined)?.drop();
  });

  async function insertPatient(legacyId: string): Promise<string> {
    const [row] = await database.db
      .insert(patients)
      .values({ ...rows.patientRow(), signupDate: '2024-01-01' })
      .returning({ id: patients.id });
    const id = (row as { id: string }).id;
    await database.db.insert(patientLegacyIds).values({ legacyId, patientId: id });
    return id;
  }

  /** The legacy id -> patient map the run builds, resolved through the alias table as it is. */
  async function patientIds(): Promise<Map<string, string>> {
    const aliases = await database.db.select().from(patientLegacyIds);
    return new Map(aliases.map((alias) => [alias.legacyId, alias.patientId]));
  }

  const mergeTier1 = async () =>
    mergeTier1Groups(
      database.db,
      [group],
      await patientIds(),
      TYPES,
      await humanOwnedFields(database.db, 'patient'),
    );

  beforeEach(async () => {
    await database.truncateAll();
    // The survivor is the row with intakes, so the direction is fixed and the test is not about
    // which row wins (ADR-0006).
    survivorId = await insertPatient('recSurvivor');
    loserId = await insertPatient('recLoser');
    group = {
      members: [identityRow('recLoser'), identityRow('recSurvivor', { intakeCount: 2 })],
      matchedKeys: [{ kind: 'email', value: 'sanne@example.com' }],
      tier: 1,
      contradictions: [],
      differences: [],
    };
  });

  it('merges the pair on the first run and finds its own work on the second', async () => {
    expect(await mergeTier1()).toEqual({
      merged: 1,
      alreadyMerged: 0,
      gainedFields: 0,
      humanDecided: 0,
    });

    expect(await mergeTier1()).toEqual({
      merged: 0,
      alreadyMerged: 1,
      gainedFields: 0,
      humanDecided: 0,
    });
  });

  // Without this the importer undid the reviewer's decision on the next run, and (ADR-0012 item 1
  // aside) did so with no audit entry, because the second merge's key repeated the first's.
  it('leaves a pair a reviewer unmerged alone, and counts it', async () => {
    await mergeTier1();
    const [merged] = await database.db.select().from(patients).where(eq(patients.id, loserId));
    expect(merged?.mergedInto).toBe(survivorId);
    await unmergePatient(database.db, {
      loserId,
      actor: 'dr. reviewer',
      reason: 'not the same person after all',
      declaredConsentTypes: TYPES,
    });

    const result = await mergeTier1();

    expect(result).toEqual({ merged: 0, alreadyMerged: 0, gainedFields: 0, humanDecided: 1 });
    const [loser] = await database.db.select().from(patients).where(eq(patients.id, loserId));
    expect(loser?.mergedInto).toBeNull();
    const [alias] = await database.db
      .select()
      .from(patientLegacyIds)
      .where(eq(patientLegacyIds.legacyId, 'recLoser'));
    expect(alias?.patientId).toBe(loserId);
    // And it stays that way: the decision is not re-litigated once per run.
    expect((await mergeTier1()).humanDecided).toBe(1);
  });
});
