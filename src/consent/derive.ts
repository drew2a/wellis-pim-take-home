// The consent state of ADR-0005: one pure function over a patient's events in `at` order, shared
// by the importer and by Part B, which recomputes on every new event. The log is evidence and is
// never touched; the state is what we act on (`CLAUDE.md` §6).
//
// No I/O, no clock: "future" is never asked here. A future-dated revocation simply wins as the
// last event, which is the safe direction, and the report counts those events from the run's
// --as-of (ADR-0009 item 5).

/** The states of ADR-0005, matching the `consent_state` enum. */
export type ConsentState = 'granted' | 'revoked' | 'no_record' | 'unknown_pre_log' | 'conflict';

export interface ConsentEventInput {
  /** `consent_events.id`, so the derived row can name the event it followed. */
  readonly id: string;
  readonly type: string;
  readonly action: 'granted' | 'revoked';
  readonly at: Date;
}

export interface DerivedConsentState {
  readonly type: string;
  readonly state: ConsentState;
  /** The event the state follows from; null when there is no event to point at. */
  readonly derivedFromEventId: string | null;
}

export interface DerivationInput {
  /** Every event of the patient, in any order. After a merge: of every patient in its membership. */
  readonly events: readonly ConsentEventInput[];
  /** ISO date, or null when the export gave none we could read (ADR-0009 item 1). */
  readonly signupDate: string | null;
  /** The types a state is derived for even when the patient has no event of that type. */
  readonly declaredTypes: readonly string[];
  /** ISO date the log begins; before it, silence says nothing (data-profile P-29). */
  readonly logStarts?: string;
}

/**
 * Bumped when the rules below change, so `consent_states.derivation_version` says which reading
 * produced a stored row (ADR-0004).
 */
export const CONSENT_DERIVATION_VERSION = '1';

/** The consent log's first year: 2023 (data-profile P-29). */
export const CONSENT_LOG_STARTS = '2023-01-01';

// A grant and a revocation at the same instant resolve to revoked (ADR-0005), which falls out of
// ordering revocations last and then reading the final event.
const ACTION_ORDER = { granted: 0, revoked: 1 } as const;

function byTimeThenRevokedLast(a: ConsentEventInput, b: ConsentEventInput): number {
  const time = a.at.getTime() - b.at.getTime();
  if (time !== 0) return time;
  const action = ACTION_ORDER[a.action] - ACTION_ORDER[b.action];
  if (action !== 0) return action;
  // Two events of the same action at the same instant: order by id so the result is the same on
  // every run, whatever order the database returned them in.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * A revocation that precedes every grant revokes something that was never granted: the log
 * contradicts itself, so neither reading is one we may act on (ADR-0005: 7 in this export,
 * "treated as not granted until resolved").
 *
 * The test is only "the first event is a revocation". ADR-0005 describes these rows as "revoke
 * before grant and before signup", but that is a description of six of the seven: one patient
 * (`recrji0nd3KzVGPAJ`) revoked the day after signing up and was granted eight days later, and
 * only this reading reproduces the accepted count (ADR-0011 item 15). The signup date plays no
 * part: a contradiction between two events is visible without it.
 */
function conflictingRevocation(ordered: readonly ConsentEventInput[]): ConsentEventInput | null {
  const first = ordered[0];
  return first?.action === 'revoked' ? first : null;
}

function stateForType(
  events: readonly ConsentEventInput[],
  input: DerivationInput,
): Omit<DerivedConsentState, 'type'> {
  if (events.length === 0) {
    const logStarts = input.logStarts ?? CONSENT_LOG_STARTS;
    // Silence before the log began says nothing about consent; silence after it is a missing
    // record. A patient whose signup date the export did not give cannot be placed on either
    // side, and the log's coverage is unknowable for them (ADR-0011 item 6).
    const known = input.signupDate !== null && input.signupDate >= logStarts;
    return { state: known ? 'no_record' : 'unknown_pre_log', derivedFromEventId: null };
  }
  const ordered = [...events].sort(byTimeThenRevokedLast);
  const conflict = conflictingRevocation(ordered);
  if (conflict !== null) return { state: 'conflict', derivedFromEventId: conflict.id };
  const last = ordered[ordered.length - 1] as ConsentEventInput;
  return { state: last.action, derivedFromEventId: last.id };
}

/**
 * One state per type: the declared types plus every type the patient has an event for, in that
 * order. A type nobody declared is never folded into another (ADR-0009 item 8).
 */
export function deriveConsentStates(input: DerivationInput): DerivedConsentState[] {
  const byType = new Map<string, ConsentEventInput[]>();
  for (const type of input.declaredTypes) byType.set(type, []);
  for (const event of input.events) {
    byType.set(event.type, [...(byType.get(event.type) ?? []), event]);
  }
  return [...byType.entries()].map(([type, events]) => ({
    type,
    ...stateForType(events, input),
  }));
}
