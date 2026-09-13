// What an `identity_conflict` item shows a reviewer: the competing records side by side (R-C4).
//
// The rows come from the **canonical tables**, not from the item's payload. The payload is a
// snapshot taken at import and the decision is about the records as they are now — a value another
// item already corrected must not reappear here as the thing to choose. What the payload is read
// for is why the item was raised at all: which keys matched, which facts contradict, which tier.
//
// Two payload shapes carry that, and both are in the queue today (ADR-0023 item 4): an item the
// importer raised names its rows by `legacy_id`, and one the new flow raised names an existing
// patient by `patient_id` beside the record the submission created.
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import type { Queryable } from '@/db/queryable';
import { consentStates, intakes, patients, type reviewItems } from '@/db/schema';

import { maskIdentifier } from './mask';
import { membersOf } from './membership';

/** Shown side by side. `source` and `signup_date` describe the row, not the person (ADR-0006). */
export const COMPARED_FIELDS = [
  'full_name',
  'email',
  'dob',
  'sex',
  'bsn',
  'phone',
  'city',
  'weight_kg',
  'height_cm',
  'status',
  'signup_date',
  'source',
] as const;

export type ComparedField = (typeof COMPARED_FIELDS)[number];

/** The fields a reviewer may pick or edit: the ten ADR-0006 calls "about the person". */
export const DECIDABLE_FIELDS: readonly ComparedField[] = COMPARED_FIELDS.filter(
  (field) => field !== 'signup_date' && field !== 'source',
);

export interface ConflictCandidate {
  readonly patientId: string;
  readonly legacyIds: readonly string[];
  /** Every compared field as text, `bsn` masked (`./mask.ts`); null where the row holds nothing. */
  readonly fields: Readonly<Record<ComparedField, string | null>>;
  readonly intakeCount: number;
  readonly consentStates: Readonly<Record<string, string>>;
  /** Set when this record has itself been merged away since the item was raised. */
  readonly mergedInto: string | null;
}

export interface ConflictView {
  readonly candidates: readonly ConflictCandidate[];
  readonly matchedKeys: readonly string[];
  readonly contradictions: readonly string[];
  readonly tier: number | null;
  /** The fields on which the candidates do not agree, which the screen highlights. */
  readonly differing: readonly ComparedField[];
}

const legacyPayload = z.object({
  rows: z.array(z.object({ legacy_id: z.string() })).min(1),
  tier: z.number().optional(),
  matched_keys: z.array(z.string()).default([]),
  contradictions: z.array(z.string()).default([]),
});

const newFlowPayload = z.object({
  existing: z.array(z.object({ patient_id: z.string() })).min(1),
  matched_keys: z.array(z.string()).default([]),
});

/** A column's value as text. Every compared column holds text or a number; nothing else. */
const text = (value: string | number | null): string | null =>
  value === null ? null : String(value);

function fieldsOf(row: typeof patients.$inferSelect): Record<ComparedField, string | null> {
  return {
    full_name: row.fullName,
    email: row.email,
    dob: row.dob,
    sex: row.sex,
    // Masked by default everywhere, until the open vocabulary item on bsn retention is answered.
    bsn: row.bsn === null ? null : maskIdentifier(row.bsn),
    phone: row.phone,
    city: row.city,
    weight_kg: text(row.weightKg),
    height_cm: text(row.heightCm),
    status: row.status,
    signup_date: row.signupDate,
    source: row.source,
  };
}

/** A patient's own record, with the counts a reviewer weighs a merge by. */
async function candidate(db: Queryable, patientId: string): Promise<ConflictCandidate | null> {
  const [row] = await db.select().from(patients).where(eq(patients.id, patientId));
  if (row === undefined) return null;

  // Through membership, never the copied patient_id (ADR-0008 item 2, ADR-0011 item 3).
  const members = await membersOf(db, patientId);
  const intakeRows = await db
    .select({ id: intakes.id })
    .from(intakes)
    .where(inArray(intakes.patientId, members));
  const states = await db
    .select({ type: consentStates.type, state: consentStates.state })
    .from(consentStates)
    .where(inArray(consentStates.patientId, members));

  return {
    patientId,
    legacyIds: row.createdFromLegacyId === null ? [] : [row.createdFromLegacyId],
    fields: fieldsOf(row),
    intakeCount: intakeRows.length,
    consentStates: Object.fromEntries(states.map((each) => [each.type, each.state])),
    mergedInto: row.mergedInto,
  };
}

/**
 * The candidates an item is about, in the order the payload names them, plus why it was raised.
 * Throws on a payload shape neither reader knows: an empty conflict view would let a reviewer
 * believe there was nothing to compare (`CLAUDE.md` §2).
 */
export async function conflictView(
  db: Queryable,
  item: typeof reviewItems.$inferSelect,
): Promise<ConflictView> {
  const legacy = legacyPayload.safeParse(item.payload);
  const newFlow = newFlowPayload.safeParse(item.payload);

  let ids: string[];
  let matchedKeys: string[] = [];
  let contradictions: string[] = [];
  let tier: number | null = null;

  if (legacy.success) {
    const legacyIds = legacy.data.rows.map((row) => row.legacy_id);
    // `created_from_legacy_id`, never the alias table, which a merge repoints (ADR-0023 item 5).
    const rows = await db
      .select({ legacyId: patients.createdFromLegacyId, id: patients.id })
      .from(patients)
      .where(inArray(patients.createdFromLegacyId, legacyIds));
    const byLegacyId = new Map(rows.map((row) => [row.legacyId, row.id]));
    ids = legacyIds.flatMap((legacyId) => {
      const id = byLegacyId.get(legacyId);
      return id === undefined ? [] : [id];
    });
    matchedKeys = legacy.data.matched_keys;
    contradictions = legacy.data.contradictions;
    tier = legacy.data.tier ?? null;
  } else if (newFlow.success) {
    // The record the submission created is the item's own patient; the payload names the rest.
    ids = [
      ...(item.patientId === null ? [] : [item.patientId]),
      ...newFlow.data.existing.map((row) => row.patient_id),
    ];
    matchedKeys = newFlow.data.matched_keys;
  } else {
    throw new Error(`review item ${item.id} carries no identity rows this console can read`);
  }

  const candidates = (await Promise.all(ids.map((id) => candidate(db, id)))).flatMap((each) =>
    each === null ? [] : [each],
  );
  const differing = COMPARED_FIELDS.filter(
    (field) => new Set(candidates.map((each) => each.fields[field])).size > 1,
  );
  return { candidates, matchedKeys, contradictions, tier, differing };
}
