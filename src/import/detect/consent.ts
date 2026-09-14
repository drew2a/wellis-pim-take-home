// The consent review items of ADR-0005. The derivation itself is in `src/consent/derive.ts` and
// no item changes a state: an item is a question for a human, not a correction.
//
// Which cases are items follows from what we would do about them. A revoked consent on a churned
// patient needs nobody: they left, and we stopped. A revoked consent on an *active* patient is a
// person we are still treating without permission, and someone has to look today.
import { z } from 'zod';

import { dedupeKey, type ReviewItemDraft } from '../review/items';

export interface ConsentSubject {
  /** The legacy id the item is keyed by: the lowest one resolving to this patient. */
  readonly legacyId: string;
  readonly patientId: string;
  readonly status: string;
  readonly type: string;
  readonly state: string;
  readonly signupDate: string | null;
  /** Every legacy id whose records this patient now holds, for a merged patient's payload. */
  readonly legacyIds: readonly string[];
}

/** Statuses that mean we are still doing something with the patient (ADR-0005). */
const ACTING_ON = new Set(['active', 'paused']);

interface ItemShape {
  readonly title: string;
  readonly reason: string;
  readonly rule: string;
}

function shapeFor(subject: ConsentSubject): ItemShape | null {
  if (subject.state === 'conflict') {
    return {
      title: 'consent log contradicts itself',
      reason:
        'a revocation precedes every grant, so the log revokes something that was never granted; ' +
        'treated as not granted until resolved',
      rule: 'CONSENT_CONFLICT',
    };
  }
  if (!ACTING_ON.has(subject.status)) return null;
  if (subject.state === 'revoked') {
    return {
      title: `consent revoked while the patient is ${subject.status}`,
      reason: 'the last event is a revocation and the commercial status says we are still acting',
      rule: 'CONSENT_REVOKED_WHILE_ACTIVE',
    };
  }
  if (subject.state === 'no_record' || subject.state === 'unknown_pre_log') {
    return {
      title: `no consent record for a patient who is ${subject.status}`,
      reason:
        subject.state === 'no_record'
          ? 'the patient signed up after the log begins and has no event in it'
          : "the log's coverage is unknowable for this patient: they predate it",
      rule: 'CONSENT_NO_RECORD_WHILE_ACTIVE',
    };
  }
  return null;
}

/**
 * One row item per patient whose consent state and commercial status cannot both be right:
 * 7 conflicts, 19 revoked while active, and the patients with no record we are still acting on.
 * Churned and prospect patients raise none — there is nothing to stop.
 */
export function consentItems(subjects: readonly ConsentSubject[]): ReviewItemDraft[] {
  return subjects.flatMap((subject) => {
    const shape = shapeFor(subject);
    if (shape === null) return [];
    return [
      {
        type: 'consent' as const,
        scope: 'row' as const,
        title: shape.title,
        reason: shape.reason,
        payload: {
          legacy_id: subject.legacyId,
          legacy_ids: subject.legacyIds,
          consent_type: subject.type,
          consent_state: subject.state,
          patient_status: subject.status,
          signup_date: subject.signupDate,
          actions: ['record_the_state_a_human_establishes', 'change_the_patient_status'],
          note: 'a note is required; the state is derived from the log and no item changes it',
        },
        proposedResolution: null,
        patientId: subject.patientId,
        intakeId: null,
        field: 'consent_state',
        dedupeKey: dedupeKey([
          'consent',
          'row',
          `legacy_patient:${subject.legacyId}`,
          subject.type,
          shape.rule,
          subject.state,
        ]),
      },
    ];
  });
}

/** As much of a consent item's payload as a reader of it depends on. */
const consentPayloadSchema = z.object({ consent_type: z.string().min(1) });

/**
 * The consent type one of these items is about, read back from the payload written above.
 *
 * Not `item.field`, which holds `consent_state` — the field the decision is about, which is not a
 * type. Reading the type from there looked `consent_states` up by a type no row has ever carried,
 * so every one of the seven contradicting logs derived `none`: the detail page showed the
 * non-conflict banner and offered no way to establish a state, and the route would have refused
 * one (ADR-0025 §3). The type is an identifier of what the item is about rather than a snapshot of
 * a value, so the payload is where it stays — and it is read here, beside the line that writes it.
 *
 * Throws rather than defaulting: a `consent` item without a consent type is this importer
 * misbehaving, not a condition of the export (`CLAUDE.md` §2).
 */
export function consentTypeOf(item: { readonly id: string; readonly payload: unknown }): string {
  const parsed = consentPayloadSchema.safeParse(item.payload);
  if (!parsed.success) {
    throw new Error(`review item ${item.id} carries no consent type`);
  }
  return parsed.data.consent_type;
}

export interface FutureEvent {
  readonly sourceLine: number;
  readonly legacyPatientId: string;
  readonly action: string;
  readonly at: string;
}

/**
 * One vocabulary item for every event dated after the run's `--as-of`, not one per event: that the
 * log holds future dates is one fact about the export, and the 69 rows are the evidence for it.
 * The state is unchanged — a future revocation still revokes, which is the safe direction.
 */
export function futureDatedConsentItem(
  events: readonly FutureEvent[],
  asOf: string,
): ReviewItemDraft | null {
  if (events.length === 0) return null;
  const revoked = events.filter((event) => event.action === 'revoked').length;
  return {
    type: 'vocabulary',
    scope: 'vocabulary',
    title: `${events.length} consent events are dated after ${asOf}`,
    reason:
      `${revoked} revocations and ${events.length - revoked} grants lie in the future; the states ` +
      'they produce are left as derived, because a revocation is the safe direction',
    payload: {
      as_of: asOf,
      granted: events.length - revoked,
      revoked,
      events: events.map((event) => ({
        source_line: event.sourceLine,
        legacy_patient_id: event.legacyPatientId,
        action: event.action,
        at: event.at,
      })),
    },
    proposedResolution: null,
    patientId: null,
    intakeId: null,
    field: 'at',
    dedupeKey: dedupeKey([
      'vocabulary',
      'vocabulary',
      'legacy_consent_event',
      'at',
      'CONSENT_EVENT_IN_THE_FUTURE',
      asOf,
    ]),
  };
}
