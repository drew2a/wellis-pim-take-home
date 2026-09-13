// The resolution path (ADR-0005 layer 3, ADR-0023): **the only way a canonical value changes after
// import**, and the same path whether a reviewer accepts a detector's proposal, types a value or
// decides that nothing should change at all. In one transaction it writes the value, writes the
// audit entry that says who changed it and why, and closes the item.
//
// Two properties follow from being the only writer, and both are tested:
//
//  - Every value that differs from what the importer wrote has an audit entry naming a person
//    (R-A7, R-B20). There is no "quick fix" route that updates a column on its own.
//  - Every field a reviewer writes becomes human-owned, because `humanOwnedFields` reads exactly
//    these entries, so the next import raises an item instead of rewriting the decision (R-A17).
//
// A merge is the one deliberate exception and lives in `./merge.ts`, for the reason ADR-0022 gives:
// the provenance of a merged record has to stay one entry.
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { Queryable } from '@/db/queryable';
import {
  auditEntries,
  bsnCheckEnum,
  intakes,
  patients,
  patientStatusEnum,
  reviewItems,
  sexEnum,
  type AuditChange,
} from '@/db/schema';
import { EMAIL_SYNTAX } from '@/import/mapper/email';
import { isCalendarDate } from '@/intake/today';

export type ResolvableEntity = 'patient' | 'intake';

export interface FieldChange {
  readonly entityType: ResolvableEntity;
  /** The canonical uuid. Audit entries refer to canonical rows (ADR-0009 item 3). */
  readonly entityId: string;
  /** The column name, spelled as `normalisation_records.field` and `AuditChange.field` spell it. */
  readonly field: string;
  /** The new value as text, or null to blank it. Text because that is what a reviewer types. */
  readonly value: string | null;
}

/** Who decided. The role is not here: every review-item action is open to both (ADR-0014 item 3). */
export interface ResolutionActor {
  readonly id: string;
  readonly name: string;
}

export interface ResolveRequest {
  readonly itemId: string;
  readonly reviewer: ResolutionActor;
  readonly outcome: 'resolved' | 'dismissed';
  /** The reviewer's own words, and the audit entry's `reason`. Never empty (R-C6). */
  readonly note: string;
  readonly changes?: readonly FieldChange[] | undefined;
  /** What was chosen, stored on the item: the action, the excluded rows, the accepted proposal. */
  readonly resolution?: unknown;
}

export interface CloseRequest {
  readonly itemId: string;
  readonly reviewer: ResolutionActor;
  readonly outcome: 'resolved' | 'dismissed';
  readonly note: string;
  readonly resolution?: unknown;
}

export interface ResolveResult {
  /** One audit entry per changed row, plus the decision's own entry when nothing changed. */
  readonly auditEntryIds: readonly string[];
  readonly changes: readonly AuditChange[];
}

interface Resolvable {
  /** The drizzle property behind the column name a reviewer's change names. */
  readonly property: string;
  /** What that column can hold, parsed from the text the reviewer sent. */
  readonly schema: z.ZodType;
}

/** `null` first, so a blanking decision is matched before the column's own shape is tried. */
const nullable = (schema: z.ZodType): z.ZodType => z.union([z.null(), schema]);

const calendarDate = z.string().refine(isCalendarDate, 'must be a calendar date, as YYYY-MM-DD');
const email = z.string().refine((value) => EMAIL_SYNTAX.test(value), 'must be an email address');
const wholeNumber = z
  .string()
  .regex(/^\d+$/, 'must be a whole number')
  .transform((value) => Number(value));
/** `numeric(5,1)`: drizzle reads and writes it as text, so the text is kept as it arrived. */
const oneDecimal = z.string().regex(/^\d+(\.\d)?$/, 'must be a number with at most one decimal');

/**
 * What the console may write, and nothing else. A whitelist rather than "any column of these two
 * tables" for two reasons: `merged_into` and `state` have their own paths with their own audit
 * shapes (`./merge.ts`, `@/intake/transition`), and a field name arriving from a request must
 * never be able to name a column nobody decided was a reviewer's to change.
 *
 * `outcome` is deliberately absent: a legacy medical result is history and is not rewritten
 * (`CLAUDE.md` §5); today's rules disagreeing with it is a `clinical_history` item, not an edit.
 */
const FIELDS: Readonly<Record<ResolvableEntity, Readonly<Record<string, Resolvable>>>> = {
  patient: {
    full_name: { property: 'fullName', schema: z.string().trim().min(1) },
    email: { property: 'email', schema: nullable(email) },
    dob: { property: 'dob', schema: nullable(calendarDate) },
    sex: { property: 'sex', schema: z.enum(sexEnum.enumValues) },
    bsn: { property: 'bsn', schema: nullable(z.string().regex(/^\d{9}$/, 'must be nine digits')) },
    bsn_check: { property: 'bsnCheck', schema: z.enum(bsnCheckEnum.enumValues) },
    phone: {
      property: 'phone',
      schema: nullable(z.string().regex(/^\+316\d{8}$/, 'must be a Dutch mobile in E.164')),
    },
    city: { property: 'city', schema: nullable(z.string().trim().min(1)) },
    weight_kg: { property: 'weightKg', schema: nullable(oneDecimal) },
    height_cm: { property: 'heightCm', schema: nullable(wholeNumber) },
    status: { property: 'status', schema: z.enum(patientStatusEnum.enumValues) },
    signup_date: { property: 'signupDate', schema: nullable(calendarDate) },
  },
  intake: {
    // The orphan's resolution: an intake that referenced a patient who is not in the export.
    patient_id: { property: 'patientId', schema: nullable(z.uuid()) },
    weight_kg: { property: 'weightKg', schema: nullable(oneDecimal) },
    height_cm: { property: 'heightCm', schema: nullable(wholeNumber) },
    alcohol_units_week: { property: 'alcoholUnitsWeek', schema: nullable(wholeNumber) },
  },
};

const TABLES = { patient: patients, intake: intakes } as const;

/**
 * How a stored value is written into an audit change, so `from` and `to` are comparable text.
 * Every resolvable column holds text or a number; anything else means the field table above and
 * the schema have drifted apart, which is a bug to surface rather than stringify (`CLAUDE.md` §2).
 */
function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  throw new Error(`a resolvable column holds a ${typeof value}, which has no text form`);
}

interface ParsedValue {
  readonly property: string;
  readonly parsed: unknown;
}

/**
 * The text a reviewer typed, as the column can hold it — or a throw naming the field. Exported
 * because a merge writes the same columns from the same kind of input (ADR-0022), and one
 * declaration of what a field may hold is better than two that can drift.
 */
export function parseFieldValue(
  entityType: ResolvableEntity,
  field: string,
  value: string | null,
): ParsedValue {
  const resolvable = FIELDS[entityType][field];
  if (resolvable === undefined) {
    throw new Error(`${field} is not a field the console may write on a ${entityType}`);
  }
  const parsed = resolvable.schema.safeParse(value);
  if (!parsed.success) throw new Error(`${field}: ${z.prettifyError(parsed.error)}`);
  return { property: resolvable.property, parsed: parsed.data };
}

interface ParsedChange extends FieldChange, ParsedValue {}

function parseChange(change: FieldChange): ParsedChange {
  return { ...change, ...parseFieldValue(change.entityType, change.field, change.value) };
}

/**
 * Locks one open review item, or throws. Locked for the same reason an intake is: two reviewers may
 * have the same item open, and a decision is taken once (R-A17).
 */
async function lockOpenItem(
  tx: Queryable,
  itemId: string,
): Promise<typeof reviewItems.$inferSelect> {
  const [item] = await tx
    .select()
    .from(reviewItems)
    .where(eq(reviewItems.id, itemId))
    .for('update');
  if (item === undefined) throw new Error(`no review item ${itemId}`);
  if (item.status !== 'open') {
    throw new Error(`review item ${itemId} is already ${item.status}; a decision is taken once`);
  }
  return item;
}

function closeItem(tx: Queryable, request: CloseRequest): Promise<unknown> {
  return tx
    .update(reviewItems)
    .set({
      status: request.outcome,
      // The name as it is now, like `audit_entries.actor`: the row is a record of a decision and
      // must still say who took it after the person is renamed (ADR-0023 item 6).
      resolvedBy: request.reviewer.name,
      resolvedAt: sql`now()`,
      resolutionNote: request.note,
      resolution: request.resolution ?? null,
    })
    .where(eq(reviewItems.id, request.itemId));
}

/**
 * Closes an item whose decision wrote its own audit trail — today only a merge, the one deliberate
 * exception to this path (ADR-0022). It writes no audit entry of its own, because the merge's two
 * entries already carry the actor, the note and the field provenance, and both reference the item.
 * The caller runs it inside the same transaction as that write.
 */
export async function closeReviewItem(db: Queryable, request: CloseRequest): Promise<void> {
  if (request.note.trim() === '') {
    throw new Error(`closing review item ${request.itemId} needs a note saying why (R-C6)`);
  }
  await lockOpenItem(db, request.itemId);
  await closeItem(db, request);
}

/**
 * Resolves or dismisses one review item. Throws having written nothing when the note is empty, the
 * item is missing or already closed, a field is not the console's to write, a value is not one the
 * column can hold, or the row it names does not exist — `CLAUDE.md` §2: inside the server, fail
 * loudly. A silent skip here would be a decision recorded against a value that never changed.
 */
export async function resolveReviewItem(
  db: Queryable,
  request: ResolveRequest,
): Promise<ResolveResult> {
  const { itemId, reviewer, note } = request;
  if (note.trim() === '') {
    throw new Error(`resolving review item ${itemId} needs a note saying why (R-C6)`);
  }
  const changes = (request.changes ?? []).map(parseChange);

  return db.transaction(async (tx) => {
    const item = await lockOpenItem(tx, itemId);

    const entry = (
      entityType: string,
      entityId: string,
      applied: AuditChange[] | null,
    ): typeof auditEntries.$inferInsert => ({
      actor: reviewer.name,
      actorReviewerId: reviewer.id,
      entityType,
      entityId,
      // Nothing transitions here: a resolution is a decision about a value, not about a state
      // (ADR-0014 item 7).
      fromState: null,
      toState: null,
      reason: note,
      reviewItemId: itemId,
      changes: applied,
      // Each human decision is a new event and must never collide (ADR-0008 item 1).
      dedupeKey: null,
    });

    const drafts: (typeof auditEntries.$inferInsert)[] = [];
    const applied: AuditChange[] = [];

    // Grouped by row, in the order the caller listed them, so one changed row is one entry
    // carrying every field it changed (docs/console-stories.md S-5).
    for (const [key, group] of groupByEntity(changes)) {
      const [entityType, entityId] = key;
      const table = TABLES[entityType];
      const [row] = await tx.select().from(table).where(eq(table.id, entityId));
      if (row === undefined) throw new Error(`no ${entityType} ${entityId} to resolve`);

      const patch: Record<string, unknown> = {};
      const rowChanges: AuditChange[] = [];
      for (const change of group) {
        const from = asText((row as Record<string, unknown>)[change.property]);
        if (from === change.value) continue; // Already what was chosen; nothing changed.
        patch[change.property] = change.parsed;
        rowChanges.push({ field: change.field, from, to: change.value });
      }
      if (rowChanges.length === 0) continue;

      await tx.update(table).set(patch).where(eq(table.id, entityId));
      drafts.push(entry(entityType, entityId, rowChanges));
      applied.push(...rowChanges);
    }

    // A decision that changed nothing is still a decision, and still says who took it and why.
    if (drafts.length === 0) drafts.push(entry(...subjectOf(item)));

    const written = await tx.insert(auditEntries).values(drafts).returning({ id: auditEntries.id });

    await closeItem(tx, { ...request, reviewer, note });

    return { auditEntryIds: written.map((row) => row.id), changes: applied };
  });
}

/**
 * What a decision that changed no value is recorded against: the intake the item is about, else
 * the patient, else the item itself — a vocabulary item is about a rule, not about a row.
 */
function subjectOf(item: typeof reviewItems.$inferSelect): [string, string, AuditChange[] | null] {
  if (item.intakeId !== null) return ['intake', item.intakeId, null];
  if (item.patientId !== null) return ['patient', item.patientId, null];
  return ['review_item', item.id, null];
}

type EntityKey = [ResolvableEntity, string];

function groupByEntity(changes: readonly ParsedChange[]): Map<EntityKey, ParsedChange[]> {
  const byKey = new Map<string, { key: EntityKey; group: ParsedChange[] }>();
  for (const change of changes) {
    const id = `${change.entityType}:${change.entityId}`;
    const existing = byKey.get(id);
    if (existing === undefined) {
      byKey.set(id, { key: [change.entityType, change.entityId], group: [change] });
    } else {
      existing.group.push(change);
    }
  }
  return new Map([...byKey.values()].map(({ key, group }) => [key, group]));
}
