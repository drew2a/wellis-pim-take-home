// Writes the derived `consent_states` rows (ADR-0004): one row per surviving patient and type,
// recomputed rather than patched, because the table is derived and derived rows are not evidence
// (ADR-0007). The derivation itself is pure and lives in `./derive`; this module only reads the
// events a membership covers and writes what comes back.
import { inArray } from 'drizzle-orm';

import type { Queryable } from '@/db/queryable';
import { consentEvents, consentStates, patients } from '@/db/schema';
import { membersOf, membershipBySurvivor } from '@/repo/membership';

import { CONSENT_DERIVATION_VERSION, deriveConsentStates, type ConsentEventInput } from './derive';

export interface RecomputeOptions {
  /** The types a state is derived for even where the patient has no event (ADR-0011 item 16). */
  readonly declaredTypes: readonly string[];
  /** Surviving patients to recompute; every surviving patient when omitted. */
  readonly survivorIds?: readonly string[];
}

const CHUNK = 500;

/**
 * The signup date a membership is placed by: the earliest one it holds, and none at all when any
 * member's date is unusable (ADR-0011 item 17). The cut-over asks when this person could first
 * have appeared in the log, which is the earliest date any of their rows carries; a member we
 * cannot date leaves that unknowable rather than answered by the others.
 */
function signupOf(members: readonly { signupDate: string | null }[]): string | null {
  const dates: string[] = [];
  for (const member of members) {
    if (member.signupDate === null) return null;
    dates.push(member.signupDate);
  }
  // ISO dates sort lexicographically, which is why the column is `date` and not a parsed value.
  return dates.sort()[0] ?? null;
}

/** Recomputes and rewrites the states; returns the number of rows written. */
export async function recomputeConsentStates(
  db: Queryable,
  options: RecomputeOptions,
): Promise<number> {
  const membership = await membershipFor(db, options.survivorIds);
  const memberIds = [...membership.values()].flat();
  if (memberIds.length === 0) return 0;

  const rows = await selectIn(memberIds, (ids) =>
    db
      .select({ id: patients.id, signupDate: patients.signupDate })
      .from(patients)
      .where(inArray(patients.id, ids)),
  );
  const byPatient = new Map(rows.map((row) => [row.id, row]));

  const events = await selectIn(memberIds, (ids) =>
    db
      .select({
        id: consentEvents.id,
        patientId: consentEvents.patientId,
        type: consentEvents.type,
        action: consentEvents.action,
        at: consentEvents.at,
      })
      .from(consentEvents)
      .where(inArray(consentEvents.patientId, ids)),
  );
  const eventsByPatient = new Map<string, ConsentEventInput[]>();
  for (const event of events) {
    const key = event.patientId as string;
    eventsByPatient.set(key, [...(eventsByPatient.get(key) ?? []), event]);
  }

  const values = [...membership.entries()].flatMap(([survivorId, members]) =>
    deriveConsentStates({
      events: members.flatMap((member) => eventsByPatient.get(member) ?? []),
      signupDate: signupOf(members.map((member) => byPatient.get(member) ?? { signupDate: null })),
      declaredTypes: options.declaredTypes,
    }).map((derived) => ({
      patientId: survivorId,
      type: derived.type,
      state: derived.state,
      derivedFromEventId: derived.derivedFromEventId,
      derivationVersion: CONSENT_DERIVATION_VERSION,
      computedAt: new Date(),
    })),
  );

  // Delete and rewrite rather than upsert: a member that stopped surviving must lose its rows,
  // and a type that no longer applies must not linger as a stale state.
  for (let i = 0; i < memberIds.length; i += CHUNK) {
    await db
      .delete(consentStates)
      .where(inArray(consentStates.patientId, memberIds.slice(i, i + CHUNK)));
  }
  for (let i = 0; i < values.length; i += CHUNK) {
    await db.insert(consentStates).values(values.slice(i, i + CHUNK));
  }
  return values.length;
}

/** survivor -> its members, for the given survivors or for the whole table. */
async function membershipFor(
  db: Queryable,
  survivorIds: readonly string[] | undefined,
): Promise<Map<string, string[]>> {
  if (survivorIds === undefined) return membershipBySurvivor(db);
  const membership = new Map<string, string[]>();
  for (const survivorId of survivorIds) {
    membership.set(survivorId, await membersOf(db, survivorId));
  }
  return membership;
}

async function selectIn<T>(
  ids: readonly string[],
  query: (chunk: string[]) => Promise<T[]>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await query(ids.slice(i, i + CHUNK))));
  return out;
}
