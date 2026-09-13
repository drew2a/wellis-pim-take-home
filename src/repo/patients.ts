// Finding a patient by hand — the one search in the console, used when a reviewer attaches an
// orphan intake to a record (ADR-0006). Deliberately exact or prefix-ish and never fuzzy: a
// similarity score is a tunable nobody can explain, and this search picks the record a medical
// history will be filed under.
import { and, eq, ilike, isNull, or, sql } from 'drizzle-orm';

import type { Queryable } from '@/db/queryable';
import { patientLegacyIds, patients } from '@/db/schema';

export interface PatientMatch {
  readonly id: string;
  readonly fullName: string;
  readonly dob: string | null;
  readonly email: string | null;
  readonly city: string | null;
}

/** Enough to choose from; a query that matches more than this is too vague to attach a record by. */
const LIMIT = 10;

/**
 * Patients whose name or email contains the query, or whose legacy id is exactly it. Only
 * **surviving** records: attaching an intake to a row that has been merged away would file it
 * where no one looks (ADR-0008 item 2).
 */
export async function searchPatients(db: Queryable, query: string): Promise<PatientMatch[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const like = `%${trimmed}%`;
  return db
    .selectDistinct({
      id: patients.id,
      fullName: patients.fullName,
      dob: patients.dob,
      email: patients.email,
      city: patients.city,
    })
    .from(patients)
    .leftJoin(patientLegacyIds, eq(patientLegacyIds.patientId, patients.id))
    .where(
      and(
        isNull(patients.mergedInto),
        or(
          ilike(patients.fullName, like),
          ilike(patients.email, like),
          eq(patients.createdFromLegacyId, trimmed),
          eq(patientLegacyIds.legacyId, trimmed),
        ),
      ),
    )
    .orderBy(sql`lower(${patients.fullName})`)
    .limit(LIMIT);
}
