/**
 * The named processes that write audit entries (ADR-0009 item 4). Any actor not in this set is a
 * human, and a field a human names in `audit_entries.changes` is human-owned: the importer never
 * rewrites it (ADR-0004, R-A17). Part B adds the engine's actor here and nowhere else.
 */
export const LEGACY_IMPORT_ACTOR = 'legacy import';
export const IMPORTER_ACTOR = 'importer';

export const SYSTEM_ACTORS: ReadonlySet<string> = new Set([LEGACY_IMPORT_ACTOR, IMPORTER_ACTOR]);
