import { getTableName, type Table } from 'drizzle-orm';

import * as schema from './schema';

/**
 * The tables ADR-0007 locks with the `reject_evidence_mutation` trigger: what is evidence is
 * immutable in the database; what is derived or decided is not. Declared once, here, and read by
 * the append-only test (which also compares it with pg_trigger), and by the schema diagram. The
 * trigger itself is installed by `drizzle/0001_append_only_evidence.sql`.
 */
export const APPEND_ONLY_TABLES: readonly Table[] = [
  schema.legacyPatientsRaw,
  schema.legacyIntakesRaw,
  schema.legacyConsentEventsRaw,
  schema.consentEvents,
  schema.normalisationRecords,
  schema.auditEntries,
];

export const APPEND_ONLY_TABLE_NAMES: ReadonlySet<string> = new Set(
  APPEND_ONLY_TABLES.map((table) => getTableName(table)),
);
