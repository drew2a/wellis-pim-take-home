// Canonical layer (ADR-0004, ADR-0006, ADR-0008, R-A15, R-A17): the export loads once, a second
// load changes nothing, orphans keep a null patient, every legacy intake has one audit entry, and
// a field a human touched survives a re-run while the mapping conflict is reported.
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { auditEntries, intakes, patientLegacyIds, patients } from '@/db/schema';
import { loadRules } from '@/rules/load';
import { createTestDatabase, type TestDatabase } from '@/test/database';

import { mapConsentEvent } from '../mapper/consent-event';
import { mapIntake } from '../mapper/intake';
import { mapPatient } from '../mapper/patient';
import { startRun } from '../runs';
import { parseCsv } from '../source/csv';
import { readExportFiles } from '../source/files';
import { parseConsentsJsonl } from '../source/jsonl';
import { INTAKES_HEADER, PATIENTS_HEADER, byHeader } from '../source/layout';
import { loadConsentEvents } from './consent-events';
import { humanOwnedFields } from './human-owned';
import { loadIntakes } from './intakes';
import { loadPatients } from './patients';

const context = { asOf: '2026-09-08', rules: loadRules() };
const files = readExportFiles('legacy_export');
const mappedPatients = parseCsv(files['patients.csv'].bytes, PATIENTS_HEADER).map((r) =>
  mapPatient(byHeader(PATIENTS_HEADER, r.fields), context),
);
const mappedIntakes = parseCsv(files['intakes.csv'].bytes, INTAKES_HEADER).map((r) =>
  mapIntake(byHeader(INTAKES_HEADER, r.fields), context),
);
const mappedConsents = parseConsentsJsonl(files['consents.jsonl'].bytes).map((r) =>
  mapConsentEvent(r.lineNo, r.fields),
);
const draftCount =
  mappedPatients.reduce((n, p) => n + p.records.length, 0) +
  mappedIntakes.reduce((n, i) => n + i.records.length, 0) +
  mappedConsents.reduce((n, c) => n + c.records.length, 0);

const TABLES = [
  'patients',
  'patient_legacy_ids',
  'intakes',
  'consent_events',
  'audit_entries',
  'normalisation_records',
];

describe('canonical load', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
    await database.migrate();
  });

  afterAll(async () => {
    await (database as TestDatabase | undefined)?.drop();
  });

  async function counts(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const table of TABLES) {
      const [row] = await database.sql<
        { n: string }[]
      >`select count(*)::text as n from ${database.sql(table)}`;
      out[table] = Number(row?.n);
    }
    return out;
  }

  async function loadAll(): Promise<{
    patients: Awaited<ReturnType<typeof loadPatients>>;
    intakes: Awaited<ReturnType<typeof loadIntakes>>;
    consents: Awaited<ReturnType<typeof loadConsentEvents>>;
  }> {
    const runId = await startRun(database.db, { files, asOf: '2026-09-08', dryRun: false });
    const p = await loadPatients(
      database.db,
      runId,
      mappedPatients,
      await humanOwnedFields(database.db, 'patient'),
    );
    const i = await loadIntakes(
      database.db,
      runId,
      mappedIntakes,
      p.ids,
      await humanOwnedFields(database.db, 'intake'),
    );
    const c = await loadConsentEvents(database.db, runId, mappedConsents, p.ids);
    return { patients: p, intakes: i, consents: c };
  }

  it('loads every patient, intake and consent event once with every normalisation record', async () => {
    const result = await loadAll();
    expect(result.patients.inserted).toBe(2466);
    expect(result.intakes.inserted).toBe(2917);
    expect(result.intakes.orphans).toHaveLength(21);
    expect(result.intakes.auditEntriesInserted).toBe(2917);
    expect(result.consents.inserted).toBe(2643);
    expect(result.consents.skipped).toBe(0);
    expect([result.patients.conflicts, result.intakes.conflicts]).toEqual([[], []]);
    // Every draft became a row: no two drafts of one run collide on the dedupe key.
    expect(
      result.patients.recordsInserted +
        result.intakes.recordsInserted +
        result.consents.recordsInserted,
    ).toBe(draftCount);
    expect(await counts()).toEqual({
      patients: 2466,
      patient_legacy_ids: 2466,
      intakes: 2917,
      consent_events: 2643,
      audit_entries: 2917,
      normalisation_records: draftCount,
    });
  });

  // The alias is what resolves every intake and consent event to a person, so a legacy id
  // pointing at the wrong patients row would silently attach one person's medical and consent
  // history to another. Checked by content, not by insert order.
  it('points every legacy id at the patient row mapped from that legacy row', async () => {
    const rows = await database.db
      .select({ legacyId: patientLegacyIds.legacyId, fullName: patients.fullName })
      .from(patientLegacyIds)
      .innerJoin(patients, eq(patients.id, patientLegacyIds.patientId));
    expect(rows).toHaveLength(2466);
    const names = new Map(rows.map((r) => [r.legacyId, r.fullName]));
    const wrong = mappedPatients.filter((p) => names.get(p.legacyId) !== p.canonical.fullName);
    expect(wrong.map((p) => p.legacyId)).toEqual([]);
  });

  it('keeps orphans with a null patient and the raw legacy id (ADR-0006)', async () => {
    const orphans = await database.db
      .select({ legacyPatientId: intakes.legacyPatientId })
      .from(intakes)
      .where(sql`${intakes.patientId} is null`);
    expect(orphans).toHaveLength(21);
    expect(orphans.every((o) => o.legacyPatientId?.startsWith('rec'))).toBe(true);
    const [linked] = await database.sql<{ n: string }[]>`
      select count(*)::text as n from intakes i
      join patient_legacy_ids a on a.legacy_id = i.legacy_patient_id
      where i.patient_id = a.patient_id
    `;
    expect(Number(linked?.n)).toBe(2896);
  });

  it('writes one legacy-import audit entry per intake naming the raw outcome', async () => {
    const [row] = await database.db
      .select({ id: intakes.id, state: intakes.state })
      .from(intakes)
      .where(eq(intakes.intakeId, 'INT-9521'));
    const entries = await database.db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.entityId, row?.id ?? ''));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actor: 'legacy import',
      entityType: 'intake',
      fromState: null,
      toState: 'legacy_rejected',
      reason: 'legacy outcome `Rejected`',
    });
    expect(entries[0]?.dedupeKey).not.toBeNull();
    const [byState] = await database.sql<{ approved: string; rejected: string; pending: string }[]>`
      select
        count(*) filter (where state = 'legacy_approved')::text as approved,
        count(*) filter (where state = 'legacy_rejected')::text as rejected,
        count(*) filter (where state = 'legacy_pending')::text as pending
      from intakes
    `;
    expect(byState).toEqual({ approved: '2068', rejected: '517', pending: '332' });
  });

  it('changes nothing on a second load (R-A15, R-A16)', async () => {
    const before = await counts();
    const result = await loadAll();
    expect(result.patients).toMatchObject({ inserted: 0, updated: 0, recordsInserted: 0 });
    expect(result.intakes).toMatchObject({
      inserted: 0,
      updated: 0,
      auditEntriesInserted: 0,
      recordsInserted: 0,
    });
    expect(result.consents).toMatchObject({ inserted: 0, recordsInserted: 0 });
    expect(await counts()).toEqual(before);
  });

  it('never rewrites a human-owned field and reports the conflict (R-A17)', async () => {
    const legacyId = mappedPatients[0]?.legacyId ?? '';
    const [alias] = await database.sql<{ patientId: string }[]>`
      select patient_id as "patientId" from patient_legacy_ids where legacy_id = ${legacyId}
    `;
    const patientId = alias?.patientId ?? '';
    const [entry] = await database.db
      .insert(auditEntries)
      .values({
        actor: 'dr. reviewer',
        entityType: 'patient',
        entityId: patientId,
        reason: 'patient asked for the address on file to change',
        changes: [{ field: 'email', from: 'zeynep.chen@live.nl', to: 'z.chen@example.org' }],
      })
      .returning({ id: auditEntries.id });
    await database.db
      .update(patients)
      .set({ email: 'z.chen@example.org', city: 'Edited by hand' })
      .where(eq(patients.id, patientId));

    const result = await loadAll();

    const [after] = await database.db.select().from(patients).where(eq(patients.id, patientId));
    // The human-owned email survives; the city, touched without an audit entry, is rewritten
    // from raw like any other canonical value.
    expect(after?.email).toBe('z.chen@example.org');
    expect(after?.city).toBe('Delft');
    expect(result.patients.updated).toBe(1);
    expect(result.patients.conflicts).toEqual([
      {
        entityType: 'patient',
        entityId: patientId,
        naturalKey: legacyId,
        field: 'email',
        stored: 'z.chen@example.org',
        mapped: 'zeynep.chen@live.nl',
        auditEntryId: entry?.id,
      },
    ]);
  });

  // `legacy_pending -> in_review` is the machine's one door out of the legacy states (ADR-0014
  // item 7), and since the state-machine trigger the database enforces that: a human cannot reopen
  // a legacy intake the legacy process decided, only one it left open.
  it('treats state as human-owned after a human transition', async () => {
    const [row] = await database.db
      .select({ id: intakes.id })
      .from(intakes)
      .where(eq(intakes.intakeId, 'INT-8830'));
    const intakeId = row?.id ?? '';
    await database.db.insert(auditEntries).values({
      actor: 'dr. reviewer',
      entityType: 'intake',
      entityId: intakeId,
      fromState: 'legacy_pending',
      toState: 'in_review',
      reason: 'reopened on the patient request',
    });
    await database.db.update(intakes).set({ state: 'in_review' }).where(eq(intakes.id, intakeId));

    const result = await loadAll();

    const [after] = await database.db.select().from(intakes).where(eq(intakes.id, intakeId));
    expect(after?.state).toBe('in_review');
    expect(result.intakes.conflicts).toEqual([
      expect.objectContaining({
        entityType: 'intake',
        entityId: intakeId,
        naturalKey: 'INT-8830',
        field: 'state',
        stored: 'in_review',
        mapped: 'legacy_pending',
      }),
    ]);
    // No second legacy-import entry: the dedupe key found the first one.
    const legacyEntries = await database.db
      .select()
      .from(auditEntries)
      .where(
        sql`${auditEntries.entityId} = ${intakeId} and ${auditEntries.actor} = 'legacy import'`,
      );
    expect(legacyEntries).toHaveLength(1);
  });
});
