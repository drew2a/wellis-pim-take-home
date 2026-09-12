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

import { dedupeKeyFor } from './audit';
import { maskIdentifier } from './mask';
import { survivorOf } from './membership';

/**
 * The fields ADR-0006 calls "about the person". `source` and `signup_date` are deliberately absent:
 * they describe the row — which funnel created it, when — and two rows from two funnels on two
 * dates is exactly the "signed up twice" the export notes describe, so the survivor keeps its own.
 *
 * `empty` is the value that counts as "not held", so that a survivor with `sex` `unknown` can gain
 * the loser's `female` while a survivor with `female` never loses it.
 */
type PersonField =
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
const MERGED_INTO = 'merged_into';
/** One change per repointed alias row: legacy id X stopped resolving to the loser. */
const ALIAS = 'patient_id';

export interface MergeRequest {
  readonly survivorId: string;
  readonly loserId: string;
  /** `importer` for a tier-1 merge, a human identity for a decision taken in the console. */
  readonly actor: string;
  /** Names the survivor rule that chose this direction (ADR-0006). */
  readonly reason: string;
  readonly declaredConsentTypes: readonly string[];
  readonly reviewItemId?: string | null;
}

export interface MergeOutcome {
  /** False when the pair was already merged: a re-run finds its own work and does nothing. */
  readonly merged: boolean;
  readonly gained: AuditChange[];
  readonly repointedLegacyIds: string[];
}

export interface UnmergeRequest {
  readonly loserId: string;
  readonly actor: string;
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
  const { survivorId, loserId } = request;
  if (survivorId === loserId) throw new Error(`cannot merge patient ${loserId} into itself`);
  const survivor = await patientRow(db, survivorId, 'survivor');
  const loser = await patientRow(db, loserId, 'loser');

  if (loser.mergedInto === survivorId) {
    return { merged: false, gained: [], repointedLegacyIds: [] };
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

  const gained = fieldsGained(survivor, loser, sourceLegacyId);
  if (gained.length > 0)
    await db.update(patients).set(patchFrom(loser, gained)).where(eq(patients.id, survivorId));

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
      changes: [{ field: MERGED_FROM, from: null, to: loserId }, ...gained],
    },
  ]);

  await recomputeConsentStates(db, {
    declaredTypes: request.declaredConsentTypes,
    survivorIds: [survivorId],
  });
  return { merged: true, gained, repointedLegacyIds };
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
    await db.update(patients).set(emptyPatch(released)).where(eq(patients.id, survivorId));
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
 * The survivor's patch for an unmerge. A gained field was empty before the merge by definition, so
 * the value to restore is the field's own empty value and never a stored one — which is also why
 * a masked `bsn` costs nothing: unmerge writes null, not the digits.
 */
function emptyPatch(released: readonly AuditChange[]): Partial<PatientRow> {
  const patch: Partial<PatientRow> = {};
  for (const change of released) {
    if (change.field === 'bsn_check') {
      patch.bsnCheck = 'absent';
      continue;
    }
    const field = FIELD_BY_COLUMN.get(change.field);
    if (field === undefined) throw new Error(`unmerge cannot write unknown field ${change.field}`);
    Object.assign(patch, { [field]: PERSON_FIELDS[field].empty });
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

async function writeEntries(
  db: Queryable,
  request: { actor: string; reviewItemId?: string | null },
  drafts: readonly EntryDraft[],
): Promise<void> {
  await db
    .insert(auditEntries)
    .values(
      drafts.map((draft) => ({
        actor: request.actor,
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
