// The audit entry's idempotency key (ADR-0008 item 1): importer-written entries build it
// deterministically from five fields, so a re-run finds its own entry under the append-only
// trigger; human entries leave it null, because each human decision is a new event that must
// never collide with another.
import { SYSTEM_ACTORS } from '@/import/actors';

export function auditDedupeKey(
  entityType: string,
  entityId: string,
  fromState: string | null,
  toState: string | null,
  reason: string,
): string {
  return [entityType, entityId, fromState ?? '', toState ?? '', reason].join('|');
}

/** The key for an entry this actor writes: deterministic for a named process, null for a human. */
export function dedupeKeyFor(
  actor: string,
  entityType: string,
  entityId: string,
  fromState: string | null,
  toState: string | null,
  reason: string,
): string | null {
  return SYSTEM_ACTORS.has(actor)
    ? auditDedupeKey(entityType, entityId, fromState, toState, reason)
    : null;
}
