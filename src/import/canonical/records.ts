// Normalisation records (ADR-0004, R-A7): one row per changed value, keyed for idempotency on
// (entity_type, entity_id, field, rule_code, from_value, to_value) with NULLS NOT DISTINCT
// (ADR-0008), so a re-run inserts nothing. entity_id is the legacy row's natural key (ADR-0009
// item 3). Evidence is the rule's static P-n / H-n reference merged with the per-row detail.
import { normalisationRecords } from '@/db/schema';

import type { Queryable } from '@/db/queryable';
import { RULE_CODES } from '../mapper/rule-codes';
import type { RecordDraft } from '../mapper/types';
import { IMPORTER_VERSION } from '../version';

export type LegacyEntityType = 'legacy_patient' | 'legacy_intake' | 'legacy_consent_event';

/**
 * A legacy row is named by its natural key; a row the new flow created has none and is named by
 * its canonical uuid, with the entity type saying which convention applies (ADR-0009 item 3).
 */
export type NormalisationEntityType = LegacyEntityType | 'patient' | 'intake';

export interface EntityRecords {
  readonly entityType: NormalisationEntityType;
  readonly entityId: string;
  readonly records: readonly RecordDraft[];
}

const CHUNK = 500;

/** Inserts every draft, ignoring the ones a previous run already wrote. Returns the inserted count. */
export async function insertNormalisationRecords(
  db: Queryable,
  // Null for a record written outside an import run — the intake form canonicalising a name or an
  // email applies the same rules and writes the same kind of row (ADR-0015 item 5).
  runId: number | null,
  entities: readonly EntityRecords[],
): Promise<number> {
  const rows = entities.flatMap((entity) =>
    entity.records.map((record) => ({
      importRunId: runId,
      importerVersion: IMPORTER_VERSION,
      entityType: entity.entityType,
      entityId: entity.entityId,
      field: record.field,
      fromValue: record.from,
      toValue: record.to,
      ruleCode: record.ruleCode,
      evidence: { ...RULE_CODES[record.ruleCode], ...record.detail },
    })),
  );
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const returned = await db
      .insert(normalisationRecords)
      .values(rows.slice(i, i + CHUNK))
      .onConflictDoNothing()
      .returning({ id: normalisationRecords.id });
    inserted += returned.length;
  }
  return inserted;
}
