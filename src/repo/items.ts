// Reading one review item with the context a reviewer needs to decide it (ADR-0024): the item, the
// rule that raised it, and the rows it is about.
import { eq, inArray } from 'drizzle-orm';

import type { Queryable } from '@/db/queryable';
import { intakes, patients, reviewItems } from '@/db/schema';
import { ruleOf } from '@/import/review/items';

import { survivorOf } from './membership';

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
