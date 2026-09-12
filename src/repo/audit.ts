// The audit entry's idempotency key (ADR-0008 item 1): importer-written entries build it
// deterministically from five fields, so a re-run finds its own entry under the append-only
// trigger; human entries leave it null, because each human decision is a new event that must
// never collide with another.
//
// The five fields identify a transition, not an occurrence of one. Where an entity can reach a
// state more than once — the same pair merged, unmerged and merged again — the caller adds the
// occurrence, or the second transition's entries collide with the first's and are dropped
// (ADR-0012 item 1).
import { SYSTEM_ACTORS } from '@/import/actors';

export function auditDedupeKey(
  entityType: string,
  entityId: string,
  fromState: string | null,
  toState: string | null,
  reason: string,
  /**
   * How many times this transition has already happened, for the entries that can repeat.
   * Omitted — not zero — everywhere else, so the keys ADR-0008 fixed for the canonical load
   * stay byte-identical: an intake reaches its legacy state once and has no second occurrence.
   */
  occurrence?: number,
): string {
  const key = [entityType, entityId, fromState ?? '', toState ?? '', reason];
  if (occurrence !== undefined) key.push(String(occurrence));
  return key.join('|');
}

/** The key for an entry this actor writes: deterministic for a named process, null for a human. */
export function dedupeKeyFor(
  actor: string,
  entityType: string,
  entityId: string,
  fromState: string | null,
  toState: string | null,
  reason: string,
  occurrence?: number,
): string | null {
  return SYSTEM_ACTORS.has(actor)
    ? auditDedupeKey(entityType, entityId, fromState, toState, reason, occurrence)
    : null;
}
