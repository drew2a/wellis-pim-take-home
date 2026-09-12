// Human-owned fields (ADR-0004, R-A17, ADR-0009 item 4): a field a human actor names in
// `audit_entries.changes` for an entity, and `state` when a human transitioned the entity. The
// importer never rewrites such a field; when raw would now map differently it raises an item
// that references the audit entry.
import { and, eq, notInArray } from 'drizzle-orm';

import { auditEntries } from '@/db/schema';

import { SYSTEM_ACTORS } from '../actors';
import type { Queryable } from '../db';

export type CanonicalEntityType = 'patient' | 'intake';

/** entity uuid -> field -> the audit entry that made it human-owned (the earliest one). */
export type HumanOwned = ReadonlyMap<string, ReadonlyMap<string, string>>;

export async function humanOwnedFields(
  db: Queryable,
  entityType: CanonicalEntityType,
): Promise<HumanOwned> {
  const rows = await db
    .select({
      id: auditEntries.id,
      entityId: auditEntries.entityId,
      changes: auditEntries.changes,
      fromState: auditEntries.fromState,
      toState: auditEntries.toState,
    })
    .from(auditEntries)
    .where(
      and(
        eq(auditEntries.entityType, entityType),
        notInArray(auditEntries.actor, [...SYSTEM_ACTORS]),
      ),
    )
    .orderBy(auditEntries.at);

  const owned = new Map<string, Map<string, string>>();
  const own = (entityId: string, field: string, auditEntryId: string): void => {
    const fields = owned.get(entityId) ?? new Map<string, string>();
    if (!fields.has(field)) fields.set(field, auditEntryId);
    owned.set(entityId, fields);
  };
  for (const row of rows) {
    for (const change of row.changes ?? []) own(row.entityId, change.field, row.id);
    if (row.fromState !== null || row.toState !== null) own(row.entityId, 'state', row.id);
  }
  return owned;
}

/** A human-owned field whose stored value differs from what raw maps to now. */
export interface HumanOwnedConflict {
  readonly entityType: CanonicalEntityType;
  readonly entityId: string;
  readonly naturalKey: string;
  readonly field: string;
  readonly stored: unknown;
  readonly mapped: unknown;
  readonly auditEntryId: string;
}
