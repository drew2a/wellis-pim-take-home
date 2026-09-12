// Consent events (ADR-0004, ADR-0007, ADR-0008): stored as exported with `at` as an instant,
// patient resolved through the alias table at load, insert-only on the partial unique index
// over source_line. Lines that could not become an event are counted; their raw rows stay.
import { sql } from 'drizzle-orm';

import { consentEvents } from '@/db/schema';

import type { Queryable } from '@/db/queryable';
import type { MappedConsentEvent } from '../mapper/consent-event';
import { insertNormalisationRecords } from './records';

export interface ConsentLoadResult {
  readonly inserted: number;
  /** Lines with no canonical event: an unseen action or an unreadable time (ADR-0009 item 8). */
  readonly skipped: number;
  readonly recordsInserted: number;
}

const CHUNK = 500;

export async function loadConsentEvents(
  db: Queryable,
  runId: number,
  mapped: readonly MappedConsentEvent[],
  patientIds: ReadonlyMap<string, string>,
): Promise<ConsentLoadResult> {
  const rows = mapped.flatMap((m) =>
    m.canonical === null
      ? []
      : [
          {
            patientId: patientIds.get(m.legacyPatientId) ?? null,
            legacyPatientId: m.legacyPatientId,
            type: m.canonical.type,
            action: m.canonical.action,
            at: m.canonical.at,
            version: m.canonical.version,
            sourceLine: m.lineNo,
            importRunId: runId,
          },
        ],
  );
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const returned = await db
      .insert(consentEvents)
      .values(rows.slice(i, i + CHUNK))
      .onConflictDoNothing({
        target: consentEvents.sourceLine,
        where: sql`${consentEvents.sourceLine} is not null`,
      })
      .returning({ id: consentEvents.id });
    inserted += returned.length;
  }
  const recordsInserted = await insertNormalisationRecords(
    db,
    runId,
    mapped.map((m) => ({
      entityType: 'legacy_consent_event',
      entityId: String(m.lineNo),
      records: m.records,
    })),
  );
  return { inserted, skipped: mapped.length - rows.length, recordsInserted };
}
