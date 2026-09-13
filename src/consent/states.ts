// Writes the derived `consent_states` rows (ADR-0004): one row per surviving patient and type,
// recomputed rather than patched, because the table is derived and derived rows are not evidence
// (ADR-0007). The derivation itself is pure and lives in `./derive`; this module only reads the
// events a membership covers and writes what comes back.
import { and, eq, inArray, sql } from 'drizzle-orm';

import type { Queryable } from '@/db/queryable';
import { consentEvents, consentStates, patients } from '@/db/schema';
import { membersOf, membershipBySurvivor } from '@/repo/membership';

import {
  CONSENT_DERIVATION_VERSION,
  deriveConsentStates,
  HUMAN_DERIVATION,
  latestEvent,
  type ConsentEventInput,
} from './derive';

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

  // A state a reviewer established over a log that contradicts itself is kept while the evidence
  // it was taken over is still the latest; an event that orders after it is new evidence, and the
  // derivation resumes (ADR-0025 item 2). The decision stays in `audit_entries` either way.
  const established = await selectIn(memberIds, (ids) =>
    db
      .select({
        patientId: consentStates.patientId,
        type: consentStates.type,
        state: consentStates.state,
        derivedFromEventId: consentStates.derivedFromEventId,
        computedAt: consentStates.computedAt,
      })
      .from(consentStates)
      .where(
        and(
          inArray(consentStates.patientId, ids),
          eq(consentStates.derivationVersion, HUMAN_DERIVATION),
        ),
      ),
  );
  const humanRows = new Map(established.map((row) => [`${row.patientId}:${row.type}`, row]));

  const values = [...membership.entries()].flatMap(([survivorId, members]) =>
    deriveConsentStates({
      events: members.flatMap((member) => eventsByPatient.get(member) ?? []),
      signupDate: signupOf(members.map((member) => byPatient.get(member) ?? { signupDate: null })),
      declaredTypes: options.declaredTypes,
    }).map((derived) => {
      const human = humanRows.get(`${survivorId}:${derived.type}`);
      const latest = latestEvent(
        members.flatMap((member) =>
          (eventsByPatient.get(member) ?? []).filter((event) => event.type === derived.type),
        ),
      );
      // Kept only while the last event is still the one the decision was taken over.
      if (human?.derivedFromEventId === (latest?.id ?? null)) {
        return {
          patientId: survivorId,
          type: derived.type,
          state: human.state,
          derivedFromEventId: human.derivedFromEventId,
          derivationVersion: HUMAN_DERIVATION,
          computedAt: human.computedAt,
        };
      }
      return {
        patientId: survivorId,
        type: derived.type,
        state: derived.state,
        derivedFromEventId: derived.derivedFromEventId,
        derivationVersion: CONSENT_DERIVATION_VERSION,
        computedAt: new Date(),
      };
    }),
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

export interface EstablishRequest {
  readonly patientId: string;
  readonly type: string;
  readonly state: 'granted' | 'revoked';
}

/**
 * Writes the state a reviewer established over a log that contradicts itself (ADR-0025). It records
 * the last event that existed when they decided, so a later event supersedes the decision and the
 * derivation resumes.
 *
 * This is a **cache of a decision**, not the decision: the decision is the audit entry the caller
 * writes in the same transaction, and losing this row would lose nothing that cannot be read back.
 */
export async function establishConsentState(
  db: Queryable,
  request: EstablishRequest,
): Promise<void> {
  const members = await membersOf(db, request.patientId);
  const events = await db
    .select({
      id: consentEvents.id,
      type: consentEvents.type,
      action: consentEvents.action,
      at: consentEvents.at,
    })
    .from(consentEvents)
    .where(inArray(consentEvents.patientId, members));
  const latest = latestEvent(events.filter((event) => event.type === request.type));

  await db
    .insert(consentStates)
    .values({
      patientId: request.patientId,
      type: request.type,
      state: request.state,
      // On a human row this names the last event the decision was taken over, not the event the
      // state follows from. The two meanings are the point of ADR-0025 item 2.
      derivedFromEventId: latest?.id ?? null,
      derivationVersion: HUMAN_DERIVATION,
    })
    .onConflictDoUpdate({
      target: [consentStates.patientId, consentStates.type],
      set: {
        state: request.state,
        derivedFromEventId: latest?.id ?? null,
        derivationVersion: HUMAN_DERIVATION,
        computedAt: sql`now()`,
      },
    });
}
