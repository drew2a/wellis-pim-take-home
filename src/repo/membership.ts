// Patient membership (ADR-0008 item 2): a patient's records are its own and those of every
// patient merged into it, transitively through `merged_into`. This module is the only way to
// answer "this patient's intakes / consent events / evaluations". No query joins on a copied
// `patient_id` alone, because a merge moves no row: `consent_events` cannot be updated at all
// (ADR-0007) and a new-flow row has no legacy id for the alias table to resolve (ADR-0011 item 3).
import { inArray, sql } from 'drizzle-orm';

import type { Queryable } from '@/db/queryable';
import { consentEvents, eligibilityEvaluations, intakes, patients } from '@/db/schema';

/**
 * Every patient whose records belong to `patientId`: itself, plus everything merged into it,
 * transitively. A merged-away patient is a member of its survivor and never the reverse.
 *
 * `union` rather than `union all` so that a cycle in `merged_into` produces no new rows and the
 * recursion ends; the database forbids a self-merge but cannot express a longer cycle as a CHECK
 * (ADR-0008 item 6).
 */
export async function membersOf(db: Queryable, patientId: string): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    with recursive members as (
      select ${patients.id} from ${patients} where ${patients.id} = ${patientId}
      union
      select p.id from ${patients} p join members m on p.merged_into = m.id
    )
    select id from members
  `);
  return [...rows].map((row) => row.id);
}

/**
 * The surviving patient `patientId`'s records now belong to: itself when nothing merged it away,
 * otherwise the end of its `merged_into` chain. Throws when the chain has no end, which means a
 * cycle: resolving a survivor is the one question a cycle makes unanswerable, and answering it
 * with a guess would attach a patient's records to an arbitrary row.
 */
export async function survivorOf(db: Queryable, patientId: string): Promise<string> {
  const rows = await db.execute<{ id: string }>(sql`
    with recursive chain as (
      select ${patients.id}, ${patients.mergedInto} from ${patients}
        where ${patients.id} = ${patientId}
      union
      select p.id, p.merged_into from ${patients} p join chain c on p.id = c.merged_into
    )
    select id from chain where merged_into is null
  `);
  const survivors = [...rows];
  if (survivors.length === 1) return (survivors[0] as { id: string }).id;
  if (survivors.length === 0) {
    throw new Error(`patient ${patientId} has no survivor: merged_into forms a cycle`);
  }
  // Unreachable while merged_into is a single column: one chain cannot end twice.
  throw new Error(`patient ${patientId} resolves to ${survivors.length} survivors`);
}

/**
 * Survivor id to the ids of every patient whose records belong to it, for every surviving
 * patient, in one query. The consent derivation runs over this map, so it must cover the whole
 * table: a patient missing from it would lose its consent state silently, which is what the count
 * check below refuses.
 */
export async function membershipBySurvivor(db: Queryable): Promise<Map<string, string[]>> {
  const rows = await db.execute<{ survivor: string; member: string }>(sql`
    with recursive membership as (
      select ${patients.id} as survivor, ${patients.id} as member from ${patients}
        where ${patients.mergedInto} is null
      union
      select m.survivor, p.id from ${patients} p join membership m on p.merged_into = m.member
    )
    select survivor, member from membership
  `);
  const bySurvivor = new Map<string, string[]>();
  let members = 0;
  for (const row of rows) {
    bySurvivor.set(row.survivor, [...(bySurvivor.get(row.survivor) ?? []), row.member]);
    members += 1;
  }
  const [counted] = await db.execute<{ n: string }>(sql`select count(*) as n from ${patients}`);
  const total = Number((counted as { n: string }).n);
  if (members !== total) {
    throw new Error(
      `${total - members} of ${total} patients reach no survivor: merged_into forms a cycle`,
    );
  }
  return bySurvivor;
}

export async function intakesOf(
  db: Queryable,
  patientId: string,
): Promise<(typeof intakes.$inferSelect)[]> {
  return db
    .select()
    .from(intakes)
    .where(inArray(intakes.patientId, await membersOf(db, patientId)));
}

export async function consentEventsOf(
  db: Queryable,
  patientId: string,
): Promise<(typeof consentEvents.$inferSelect)[]> {
  return db
    .select()
    .from(consentEvents)
    .where(inArray(consentEvents.patientId, await membersOf(db, patientId)));
}

/** The evaluations of every intake the membership covers, shadow rows and Part B rows alike. */
export async function evaluationsOf(
  db: Queryable,
  patientId: string,
): Promise<(typeof eligibilityEvaluations.$inferSelect)[]> {
  const ids = (await intakesOf(db, patientId)).map((intake) => intake.id);
  if (ids.length === 0) return [];
  return db
    .select()
    .from(eligibilityEvaluations)
    .where(inArray(eligibilityEvaluations.intakeId, ids));
}
