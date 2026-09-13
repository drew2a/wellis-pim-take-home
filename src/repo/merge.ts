// Merging two patients and taking it back (ADR-0006): the importer's tier-1 merges and a
// reviewer's decision in the console run this same path with a different actor, so there is one
// place where a merge happens and one shape of audit trail for both.
//
// A merge writes exactly two things — `merged_into` on the loser and the alias rows that pointed
// at it — plus the fields the survivor did not hold. Nothing that references a patient by id is
// moved: `consent_events` cannot be updated at all (ADR-0007), so moving intakes would leave the
// two tables disagreeing and would lose the loser's events on unmerge. Reading a patient's records
// is the membership function's job (ADR-0008 item 2, ADR-0011 item 3).
import { eq, inArray } from 'drizzle-orm';

import type { Queryable } from '@/db/queryable';
import { auditEntries, patientLegacyIds, patients, type AuditChange } from '@/db/schema';
import { recomputeConsentStates } from '@/consent/states';

import { elfproef } from '@/import/mapper/bsn';

import { dedupeKeyFor } from './audit';
import { maskIdentifier } from './mask';
import { survivorOf } from './membership';
import { parseFieldValue } from './resolve';

/**
 * The fields ADR-0006 calls "about the person". `source` and `signup_date` are deliberately absent:
 * they describe the row — which funnel created it, when — and two rows from two funnels on two
 * dates is exactly the "signed up twice" the export notes describe, so the survivor keeps its own.
 *
 * `empty` is the value that counts as "not held", so that a survivor with `sex` `unknown` can gain
 * the loser's `female` while a survivor with `female` never loses it.
 */
export type PersonField =
  | 'fullName'
  | 'email'
  | 'dob'
  | 'sex'
  | 'bsn'
  | 'phone'
  | 'city'
  | 'weightKg'
  | 'heightCm'
  | 'status';

const PERSON_FIELDS: Readonly<Record<PersonField, { column: string; empty: string | null }>> = {
  fullName: { column: 'full_name', empty: '' },
  email: { column: 'email', empty: null },
  dob: { column: 'dob', empty: null },
  sex: { column: 'sex', empty: 'unknown' },
  bsn: { column: 'bsn', empty: null },
  phone: { column: 'phone', empty: null },
  city: { column: 'city', empty: null },
  weightKg: { column: 'weight_kg', empty: null },
  heightCm: { column: 'height_cm', empty: null },
  status: { column: 'status', empty: 'unknown' },
};

const FIELD_BY_COLUMN: ReadonlyMap<string, PersonField> = new Map(
  (Object.keys(PERSON_FIELDS) as PersonField[]).map((field) => [
    PERSON_FIELDS[field].column,
    field,
  ]),
);

type PatientRow = typeof patients.$inferSelect;

/** The marker that links a survivor's audit entry to the merge it records, for unmerge to find. */
const MERGED_FROM = 'merged_from';
/**
 * The loser's `merged_into`, as a change. Exported because it is also the field a human owns once
 * they have unmerged a pair, which is what stops the importer merging it again (ADR-0012 item 2).
 */
export const MERGED_INTO = 'merged_into';
/** One change per repointed alias row: legacy id X stopped resolving to the loser. */
const ALIAS = 'patient_id';

/** Where a decided value came from. Recorded, not inferred: `loser` and `edited` can produce the
 * same string, and the audit has to say whether a reviewer chose a value that was in the data or
 * typed one that was not (ADR-0022 item 1). */
export type FieldSource = 'survivor' | 'loser' | 'edited';

export interface FieldDecision {
  readonly value: string | null;
  readonly source: FieldSource;
}

/** A reviewer's per-field picks. The importer passes none, and its merges are unchanged. */
export type FieldDecisions = Readonly<Partial<Record<PersonField, FieldDecision>>>;

export interface MergeRequest {
  readonly survivorId: string;
  readonly loserId: string;
  /** `importer` for a tier-1 merge, a human identity for a decision taken in the console. */
  readonly actor: string;
  /** The stable identity behind a human actor; null for a named process (ADR-0014 item 4). */
  readonly actorReviewerId?: string | null;
  /** Names the survivor rule that chose this direction (ADR-0006). */
  readonly reason: string;
  readonly declaredConsentTypes: readonly string[];
  readonly reviewItemId?: string | null;
  /**
   * What the reviewer chose, per field (R-C5, ADR-0022). A decided field wins; an undecided one
   * keeps ADR-0006's rule — the survivor keeps what it holds and gains what it lacks.
   */
  readonly fieldDecisions?: FieldDecisions | undefined;
}

export interface MergeOutcome {
  /** False when the pair was already merged: a re-run finds its own work and does nothing. */
  readonly merged: boolean;
  readonly gained: AuditChange[];
  /** The fields a reviewer chose that differed from what the survivor already held. */
  readonly decided: AuditChange[];
  readonly repointedLegacyIds: string[];
}

export interface UnmergeRequest {
  readonly loserId: string;
  readonly actor: string;
  readonly actorReviewerId?: string | null;
  readonly reason: string;
  readonly declaredConsentTypes: readonly string[];
  readonly reviewItemId?: string | null;
}

export interface UnmergeOutcome {
  readonly survivorId: string;
  readonly released: AuditChange[];
  readonly repointedLegacyIds: string[];
}

function text(value: PatientRow[PersonField]): string | null {
  return value === null ? null : String(value);
}

function held(field: PersonField, row: PatientRow): boolean {
  const value = text(row[field]);
  return value !== null && value !== '' && value !== PERSON_FIELDS[field].empty;
}

async function patientRow(db: Queryable, id: string, role: string): Promise<PatientRow> {
  const [row] = await db.select().from(patients).where(eq(patients.id, id));
  if (row === undefined) throw new Error(`${role} patient ${id} does not exist`);
  return row;
}

/**
 * Merges `loserId` into `survivorId`. Idempotent: a pair already merged this way is left alone, so
 * a second import run finds the alias repointed and does nothing (ADR-0006).
 */
export async function mergePatients(db: Queryable, request: MergeRequest): Promise<MergeOutcome> {
  // The four writes below plus the consent recomputation are one fact, so the transaction belongs
  // to this function and not to whichever caller remembers (ADR-0022 item 4). Drizzle nests this
  // as a savepoint when the caller already has one, so the importer's run is unaffected.
  return db.transaction((tx) => mergeInTransaction(tx, request));
}

async function mergeInTransaction(db: Queryable, request: MergeRequest): Promise<MergeOutcome> {
  const { survivorId, loserId } = request;
  if (survivorId === loserId) throw new Error(`cannot merge patient ${loserId} into itself`);
  const survivor = await patientRow(db, survivorId, 'survivor');
  const loser = await patientRow(db, loserId, 'loser');

  if (loser.mergedInto === survivorId) {
    return { merged: false, gained: [], decided: [], repointedLegacyIds: [] };
  }
  if (loser.mergedInto !== null) {
    throw new Error(`patient ${loserId} is already merged into ${loser.mergedInto}`);
  }
  // This is also what keeps merged_into acyclic (ADR-0011 item 5), which the database cannot
  // express as a CHECK beyond the self-merge: a cycle needs a survivor that is itself merged
  // away, and every member of a chain but its end is exactly that.
  if (survivor.mergedInto !== null) {
    throw new Error(
      `patient ${survivorId} is itself merged into ${survivor.mergedInto}; merge into the survivor`,
    );
  }

  const aliases = await db
    .select()
    .from(patientLegacyIds)
    .where(eq(patientLegacyIds.patientId, loserId));
  const repointedLegacyIds = aliases.map((alias) => alias.legacyId).sort();
  // Deterministic, and true where the loser carries several legacy ids after an earlier merge.
  const sourceLegacyId = repointedLegacyIds[0];

  const decisions = request.fieldDecisions ?? {};
  const decided = fieldsDecided(survivor, decisions, sourceLegacyId);
  // A decided field wins; an undecided one keeps ADR-0006's rule. `bsn_check` follows `bsn`.
  const decidedColumns = new Set(decided.map((change) => change.field));
  if (decisions.bsn !== undefined) decidedColumns.add('bsn_check');
  const gained = fieldsGained(survivor, loser, sourceLegacyId).filter(
    (change) => !decidedColumns.has(change.field),
  );

  const patch = { ...patchFrom(loser, gained), ...patchFromDecisions(decisions) };
  if (Object.keys(patch).length > 0)
    await db.update(patients).set(patch).where(eq(patients.id, survivorId));

  await db.update(patients).set({ mergedInto: survivorId }).where(eq(patients.id, loserId));
  if (repointedLegacyIds.length > 0) {
    await db
      .update(patientLegacyIds)
      .set({ patientId: survivorId })
      .where(inArray(patientLegacyIds.legacyId, repointedLegacyIds));
  }

  await writeEntries(db, request, [
    {
      entityId: loserId,
      fromState: 'independent',
      toState: 'merged',
      reason: `merged into patient ${survivorId}: ${request.reason}`,
      changes: [
        { field: MERGED_INTO, from: null, to: survivorId },
        ...repointedLegacyIds.map((legacyId) => ({
          field: ALIAS,
          from: loserId,
          to: survivorId,
          source_legacy_id: legacyId,
        })),
      ],
    },
    {
      entityId: survivorId,
      fromState: null,
      toState: null,
      reason: `absorbed patient ${loserId}: ${request.reason}`,
      changes: [{ field: MERGED_FROM, from: null, to: loserId }, ...gained, ...decided],
    },
  ]);

  await recomputeConsentStates(db, {
    declaredTypes: request.declaredConsentTypes,
    survivorIds: [survivorId],
  });
  return { merged: true, gained, decided, repointedLegacyIds };
}

/** Takes a merge back: the inverse of every write above, and the same audit trail in reverse. */
export async function unmergePatient(
  db: Queryable,
  request: UnmergeRequest,
): Promise<UnmergeOutcome> {
  const { loserId } = request;
  const loser = await patientRow(db, loserId, 'merged');
  const survivorId = loser.mergedInto;
  if (survivorId === null) throw new Error(`patient ${loserId} is not merged into anything`);

  const mergeOfLoser = await lastEntryWith(db, loserId, MERGED_INTO, survivorId);
  const mergeOfSurvivor = await lastEntryWith(db, survivorId, MERGED_FROM, loserId);
  if (mergeOfLoser === undefined || mergeOfSurvivor === undefined) {
    // Without the record there is no way to know which legacy ids came from this patient or which
    // of the survivor's values it supplied, and guessing would move another patient's rows.
    throw new Error(`no audit entry records the merge of ${loserId} into ${survivorId}`);
  }
  const repointedLegacyIds = (mergeOfLoser.changes ?? [])
    .filter((change) => change.field === ALIAS && change.source_legacy_id !== undefined)
    .map((change) => change.source_legacy_id as string);
  const released = (mergeOfSurvivor.changes ?? []).filter((change) => change.field !== MERGED_FROM);

  if (released.length > 0) {
    await db.update(patients).set(restorePatch(released)).where(eq(patients.id, survivorId));
  }
  await db.update(patients).set({ mergedInto: null }).where(eq(patients.id, loserId));
  if (repointedLegacyIds.length > 0) {
    await db
      .update(patientLegacyIds)
      .set({ patientId: loserId })
      .where(inArray(patientLegacyIds.legacyId, repointedLegacyIds));
  }

  await writeEntries(db, request, [
    {
      entityId: loserId,
      fromState: 'merged',
      toState: 'independent',
      reason: `unmerged from patient ${survivorId}: ${request.reason}`,
      changes: [
        { field: MERGED_INTO, from: survivorId, to: null },
        ...repointedLegacyIds.map((legacyId) => ({
          field: ALIAS,
          from: survivorId,
          to: loserId,
          source_legacy_id: legacyId,
        })),
      ],
    },
    {
      entityId: survivorId,
      fromState: null,
      toState: null,
      reason: `released patient ${loserId}: ${request.reason}`,
      changes: [
        { field: MERGED_FROM, from: loserId, to: null },
        ...released.map((change) => ({ ...change, from: change.to, to: change.from })),
      ],
    },
  ]);

  // The survivor of this merge may itself have been merged away since — merge B into A, then A
  // into C — so the states belong to the end of its chain, not to A. Writing them for A would
  // leave rows on a patient that no longer survives and leave C's own states derived over B's
  // events, which is what ADR-0011 item 13 writes them for.
  await recomputeConsentStates(db, {
    declaredTypes: request.declaredConsentTypes,
    survivorIds: [await survivorOf(db, survivorId), loserId],
  });
  return { survivorId, released, repointedLegacyIds };
}

/**
 * The fields the survivor does not hold and the loser does, in a fixed order so that two runs
 * produce the same `changes` array. A gained `bsn` carries `bsn_check` with it, or the row would
 * break the CHECK that an absent number cannot have been checked (ADR-0008 item 6); its value is
 * masked here for the same reason review-item payloads mask it — jsonb is out of reach of the
 * console's column-level masking, and bsn retention is still an open question.
 */
function fieldsGained(
  survivor: PatientRow,
  loser: PatientRow,
  sourceLegacyId: string | undefined,
): AuditChange[] {
  const changes: AuditChange[] = [];
  for (const field of Object.keys(PERSON_FIELDS) as PersonField[]) {
    if (held(field, survivor) || !held(field, loser)) continue;
    const shown = (value: string | null): string | null =>
      field === 'bsn' && value !== null ? maskIdentifier(value) : value;
    changes.push({
      field: PERSON_FIELDS[field].column,
      from: shown(text(survivor[field])),
      to: shown(text(loser[field])),
      ...(sourceLegacyId === undefined ? {} : { source_legacy_id: sourceLegacyId }),
    });
    if (field === 'bsn') {
      changes.push({
        field: 'bsn_check',
        from: survivor.bsnCheck,
        to: loser.bsnCheck,
        ...(sourceLegacyId === undefined ? {} : { source_legacy_id: sourceLegacyId }),
      });
    }
  }
  return changes;
}

/**
 * What a reviewer's picks change about the survivor, as audit changes (R-C5, ADR-0022 item 2).
 * A decision equal to the value already there writes nothing, because nothing changed.
 *
 * `source_legacy_id` is set only where the value came from the loser's row: an edited value came
 * from the reviewer, and claiming a row supplied it would be a false provenance record.
 */
function fieldsDecided(
  survivor: PatientRow,
  decisions: FieldDecisions,
  sourceLegacyId: string | undefined,
): AuditChange[] {
  const changes: AuditChange[] = [];
  for (const key of Object.keys(decisions)) {
    if (!(key in PERSON_FIELDS)) {
      throw new Error(`${key} is not a field of the person and cannot be decided in a merge`);
    }
    const field = key as PersonField;
    const decision = decisions[field];
    if (decision === undefined) continue;
    // Validated by the same declaration the resolution path uses, so the two writers of a patient
    // column cannot disagree about what it may hold (ADR-0023).
    parseFieldValue('patient', PERSON_FIELDS[field].column, decision.value);

    const current = text(survivor[field]);
    if (current === decision.value) continue;
    const shown = (value: string | null): string | null =>
      field === 'bsn' && value !== null ? maskIdentifier(value) : value;
    const provenance =
      decision.source === 'loser' && sourceLegacyId !== undefined
        ? { source_legacy_id: sourceLegacyId }
        : {};
    changes.push({
      field: PERSON_FIELDS[field].column,
      from: shown(current),
      to: shown(decision.value),
      ...provenance,
      chosen: decision.source,
    });
    if (field === 'bsn') {
      changes.push({
        field: 'bsn_check',
        from: survivor.bsnCheck,
        to: bsnCheckFor(decision.value),
        ...provenance,
        chosen: decision.source,
      });
    }
  }
  return changes;
}

/** A decided number is checked here, because nothing else will: the mapper only sees raw rows. */
const bsnCheckFor = (bsn: string | null): string =>
  bsn === null ? 'absent' : elfproef(bsn) ? 'valid' : 'invalid';

/** The survivor's patch for the reviewer's picks, in the columns' own types. */
function patchFromDecisions(decisions: FieldDecisions): Partial<PatientRow> {
  const patch: Partial<PatientRow> = {};
  for (const field of Object.keys(decisions) as PersonField[]) {
    const decision = decisions[field];
    if (decision === undefined) continue;
    const { property, parsed } = parseFieldValue(
      'patient',
      PERSON_FIELDS[field].column,
      decision.value,
    );
    Object.assign(patch, { [property]: parsed });
    if (field === 'bsn') patch.bsnCheck = bsnCheckFor(decision.value) as PatientRow['bsnCheck'];
  }
  return patch;
}

/** The survivor's patch for a merge: the loser's own values, never the masked ones. */
function patchFrom(loser: PatientRow, gained: readonly AuditChange[]): Partial<PatientRow> {
  const patch: Partial<PatientRow> = {};
  for (const change of gained) {
    if (change.field === 'bsn_check') {
      patch.bsnCheck = loser.bsnCheck;
      continue;
    }
    const field = FIELD_BY_COLUMN.get(change.field);
    if (field === undefined) throw new Error(`merge cannot write unknown field ${change.field}`);
    Object.assign(patch, { [field]: loser[field] });
  }
  return patch;
}

/**
 * The survivor's patch for an unmerge, per released field:
 *
 *  - A **gained** field was empty before the merge by definition, so the value to restore is the
 *    field's own empty value and never a stored one.
 *  - A field a reviewer **chose** had a value before the merge, and the entry records it in
 *    `from`, so that is what comes back. Without this an unmerge would blank a value the survivor
 *    had all along.
 *
 * **`bsn` is the exception, and blanks either way.** Its `from` is masked in the entry — jsonb is
 * out of reach of the console's column-level masking (`./mask.ts`) — so a chosen number cannot be
 * restored from the record. Blanking is the safe direction for an identifier, the audit entry says
 * a value was there, and the raw row still holds it. Unmerge has no console screen (R-S4).
 */
function restorePatch(released: readonly AuditChange[]): Partial<PatientRow> {
  const patch: Partial<PatientRow> = {};
  for (const change of released) {
    if (change.field === 'bsn_check') {
      patch.bsnCheck = 'absent';
      continue;
    }
    const field = FIELD_BY_COLUMN.get(change.field);
    if (field === undefined) throw new Error(`unmerge cannot write unknown field ${change.field}`);
    const restored =
      change.chosen === undefined || field === 'bsn' ? PERSON_FIELDS[field].empty : change.from;
    Object.assign(patch, {
      [field]: parseFieldValue('patient', change.field, restored).parsed,
    });
  }
  return patch;
}

interface EntryDraft {
  readonly entityId: string;
  readonly fromState: string | null;
  readonly toState: string | null;
  readonly reason: string;
  readonly changes: AuditChange[];
}

/**
 * One entry per entity, with the key ADR-0008 item 1 gives it: deterministic for the importer,
 * null for a human. A pair can be merged, unmerged and merged again, and the second merge's five
 * audit fields are byte-identical to the first's — but only a human can re-merge a pair a human
 * separated (ADR-0012 item 2), and a human entry has no key to collide with, so the second
 * transition keeps its own rows (ADR-0012 item 1).
 */
async function writeEntries(
  db: Queryable,
  request: { actor: string; actorReviewerId?: string | null; reviewItemId?: string | null },
  drafts: readonly EntryDraft[],
): Promise<void> {
  await db
    .insert(auditEntries)
    .values(
      drafts.map((draft) => ({
        actor: request.actor,
        // The stable identity behind a human actor; a named process has none (ADR-0014 item 4).
        actorReviewerId: request.actorReviewerId ?? null,
        entityType: 'patient',
        entityId: draft.entityId,
        fromState: draft.fromState,
        toState: draft.toState,
        reason: draft.reason,
        reviewItemId: request.reviewItemId ?? null,
        changes: draft.changes,
        dedupeKey: dedupeKeyFor(
          request.actor,
          'patient',
          draft.entityId,
          draft.fromState,
          draft.toState,
          draft.reason,
        ),
      })),
    )
    .onConflictDoNothing({ target: auditEntries.dedupeKey });
}

/** The most recent entry on `entityId` whose `changes` carry `field` pointing at `to`. */
async function lastEntryWith(
  db: Queryable,
  entityId: string,
  field: string,
  to: string,
): Promise<typeof auditEntries.$inferSelect | undefined> {
  const entries = await db
    .select()
    .from(auditEntries)
    .where(eq(auditEntries.entityId, entityId))
    .orderBy(auditEntries.at);
  return entries
    .filter((entry) =>
      (entry.changes ?? []).some((change) => change.field === field && change.to === to),
    )
    .at(-1);
}
