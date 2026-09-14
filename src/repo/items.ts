// Reading one review item with the context a reviewer needs to decide it (ADR-0024): the item, the
// rule that raised it, and the rows it is about.
import { and, desc, eq, inArray } from 'drizzle-orm';

import type { Queryable } from '@/db/queryable';
import { consentStates, importRuns, intakes, patients, reviewItems } from '@/db/schema';
import { ageInYears } from '@/eligibility/age';
import { consentTypeOf } from '@/import/detect/consent';
import { ruleOf } from '@/import/review/items';

import { maskIdentifier } from './mask';
import { consentEventsOf, survivorOf } from './membership';
import { writableTarget } from './resolve';

export interface ReviewItemView {
  readonly item: typeof reviewItems.$inferSelect;
  /** Read back from `dedupe_key`, the only place the rule is written down (ADR-0004). */
  readonly rule: string;
  /** The surviving patient the item is about, or null (ADR-0008 item 2). */
  readonly patient: { readonly id: string; readonly name: string } | null;
  readonly intake: {
    readonly id: string;
    readonly intakeId: string | null;
    readonly state: string;
  } | null;
}

export async function findReviewItem(db: Queryable, id: string): Promise<ReviewItemView | null> {
  const [item] = await db.select().from(reviewItems).where(eq(reviewItems.id, id));
  if (item === undefined) return null;

  let patient: ReviewItemView['patient'] = null;
  if (item.patientId !== null) {
    const survivorId = await survivorOf(db, item.patientId);
    const [row] = await db
      .select({ id: patients.id, name: patients.fullName })
      .from(patients)
      .where(eq(patients.id, survivorId));
    patient = row ?? null;
  }

  let intake: ReviewItemView['intake'] = null;
  if (item.intakeId !== null) {
    const [row] = await db
      .select({ id: intakes.id, intakeId: intakes.intakeId, state: intakes.state })
      .from(intakes)
      .where(eq(intakes.id, item.intakeId));
    intake = row ?? null;
  }

  return { item, rule: ruleOf(item.dedupeKey), patient, intake };
}

/**
 * The value a `data_quality` item is about, as it stands now — usually null, the mapper's blank.
 * Null too when nothing the item names owns the field, which is the same question the decision
 * asks: the row that would be corrected, and the column on it (`writableTarget`, ADR-0026 item 2).
 * Reading "the patient if there is one" instead told a reviewer that `submitted_at` was empty
 * whatever the intake held.
 */
export async function currentValueOf(
  db: Queryable,
  item: typeof reviewItems.$inferSelect,
): Promise<string | null> {
  const target = writableTarget(item);
  if (target === null) return null;
  const [table, id] =
    target.entityType === 'patient'
      ? ([patients, target.entityId] as const)
      : ([intakes, target.entityId] as const);
  const [row] = await db.select().from(table).where(eq(table.id, id));
  const value = (row as Record<string, unknown> | undefined)?.[target.property];
  // Every field a data_quality item names holds text or a number; anything else means the field
  // table and the schema have drifted apart (`CLAUDE.md` §2).
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`${item.field} holds a ${typeof value}, which has no text form`);
  }
  // bsn is masked wherever the console shows it (`./mask.ts`).
  return item.field === 'bsn' ? maskIdentifier(String(value)) : String(value);
}

/** Every consent event the item's patient owns, through membership, oldest first (ADR-0008). */
export async function consentTimeline(
  db: Queryable,
  item: typeof reviewItems.$inferSelect,
): Promise<{ at: string; type: string; action: string; version: string | null }[]> {
  if (item.patientId === null) return [];
  const events = await consentEventsOf(db, item.patientId);
  return events
    .map((event) => ({
      at: event.at.toISOString(),
      type: event.type,
      action: event.action,
      version: event.version,
    }))
    .sort((left, right) => left.at.localeCompare(right.at));
}

/**
 * The consent state stored for the item's patient and type right now, or null. The type comes from
 * the payload the detector wrote (`consentTypeOf`) and the patient from membership, so a record
 * merged away since the item was raised still resolves to the row the state lives on (ADR-0008).
 */
export async function derivedConsentState(
  db: Queryable,
  item: typeof reviewItems.$inferSelect,
): Promise<string | null> {
  if (item.patientId === null) return null;
  const survivor = await survivorOf(db, item.patientId);
  const [row] = await db
    .select({ state: consentStates.state })
    .from(consentStates)
    .where(and(eq(consentStates.patientId, survivor), eq(consentStates.type, consentTypeOf(item))));
  return row?.state ?? null;
}

export interface PatientStanding {
  /** The patient's commercial standing: active, paused, churned, prospect (`CLAUDE.md` §6). */
  readonly status: string;
  /** Their age on `asOf`, or null when the export gave no date of birth. */
  readonly ageYears: number | null;
  /** The `--as-of` of the run that imported them, which every "now" here is measured from. */
  readonly asOf: string;
  /** Consent as it stands, per type; empty for a patient with no state at all. */
  readonly consent: Readonly<Record<string, string>>;
}

/**
 * Whether this person is still in the programme, for an item that asks what to do about their
 * history. A `clinical_history` item is urgent or archival depending on three facts that are
 * nowhere in its payload — the payload describes an intake from 2024 — and a reviewer who has to
 * open the patient's page to find them decides 115 items with the queue out of sight.
 *
 * The age is measured from the import's `--as-of` rather than the wall clock, so that it is the
 * same date the report counted minors against (ADR-0009 item 5): a 17-year-old approved in 2024
 * may be an adult now, and which it is decides the item.
 */
export async function patientStanding(
  db: Queryable,
  item: typeof reviewItems.$inferSelect,
): Promise<PatientStanding | null> {
  if (item.patientId === null) return null;
  const survivor = await survivorOf(db, item.patientId);
  const [row] = await db
    .select({ status: patients.status, dob: patients.dob })
    .from(patients)
    .where(eq(patients.id, survivor));
  if (row === undefined) return null;

  const asOf = await importedAsOf(db);
  const states = await db
    .select({ type: consentStates.type, state: consentStates.state })
    .from(consentStates)
    .where(eq(consentStates.patientId, survivor));

  return {
    status: row.status,
    ageYears: row.dob === null ? null : ageInYears(row.dob, asOf),
    asOf,
    consent: Object.fromEntries(states.map((each) => [each.type, each.state])),
  };
}

/**
 * The reference date of the most recent real import. Dry runs are skipped: one is a rehearsal that
 * wrote nothing, and letting its `--as-of` date the console would move every age on screen without
 * a row having changed.
 */
async function importedAsOf(db: Queryable): Promise<string> {
  const [run] = await db
    .select({ asOf: importRuns.asOf })
    .from(importRuns)
    .where(eq(importRuns.dryRun, false))
    .orderBy(desc(importRuns.id))
    .limit(1);
  if (run === undefined) {
    throw new Error('no import run has stored an as-of date to measure an age against');
  }
  return run.asOf;
}

/** Whether a patient a reviewer named still exists, before a decision references it. */
export async function patientExists(db: Queryable, id: string): Promise<boolean> {
  const [row] = await db.select({ id: patients.id }).from(patients).where(eq(patients.id, id));
  return row !== undefined;
}

/** Exported intake id (`INT-8342`) to canonical uuid, for the pair a same-day item names. */
export async function intakesByExportedId(
  db: Queryable,
  exportedIds: readonly string[],
): Promise<Map<string, string>> {
  if (exportedIds.length === 0) return new Map();
  const rows = await db
    .select({ intakeId: intakes.intakeId, id: intakes.id })
    .from(intakes)
    .where(inArray(intakes.intakeId, [...exportedIds]));
  return new Map(
    rows.flatMap((row) => (row.intakeId === null ? [] : [[row.intakeId, row.id] as const])),
  );
}

/**
 * Exported row id to canonical patient, through `created_from_legacy_id` — the column that says
 * which exported row a canonical row was built from and never changes. `patient_legacy_ids` would
 * answer "whose records are these now", which a merge repoints (ADR-0011 item 18, ADR-0023 item 5).
 */
export async function patientsByLegacyId(
  db: Queryable,
  legacyIds: readonly string[],
): Promise<Map<string, string>> {
  if (legacyIds.length === 0) return new Map();
  const rows = await db
    .select({ legacyId: patients.createdFromLegacyId, id: patients.id })
    .from(patients)
    .where(inArray(patients.createdFromLegacyId, [...legacyIds]));
  return new Map(
    rows.flatMap((row) => (row.legacyId === null ? [] : [[row.legacyId, row.id] as const])),
  );
}
