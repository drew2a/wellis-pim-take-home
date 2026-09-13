// What a submission does, end to end (ADR-0015): the consent gate, the rows a submission writes,
// the normalisation records for what the patient typed, and the two detectors.
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CONSENT_TEXT_VERSION } from '@/consent/text';
import {
  auditEntries,
  consentEvents,
  consentStates,
  eligibilityEvaluations,
  intakes,
  normalisationRecords,
  patients,
  reviewItems,
} from '@/db/schema';
import { ruleOf } from '@/import/review/items';
import { loadRules } from '@/rules/load';
import { createTestDatabase, type TestDatabase, type TestDb } from '@/test/database';

import { emptyAnswers, INTAKE_FORM_VERSION, type DraftAnswers } from './answers';
import { submitIntake } from './submit';

let database: TestDatabase;
let db: TestDb;

const rules = loadRules();
const NOW = new Date('2026-09-13T10:00:00Z');

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  await database.migrate();
}, 60_000);

afterAll(async () => {
  await database.drop();
});

beforeEach(async () => {
  await database.truncateAll();
});

/** A complete, clearing submission: 40 years old, BMI 31, nothing reported. */
const complete = (patch: Partial<DraftAnswers> = {}): DraftAnswers => ({
  ...emptyAnswers(),
  identity: { fullName: 'Sem de Boer', email: 'sem@example.com', dob: '1986-04-02' },
  metrics: { heightCm: 180, weightKg: 101.0 },
  medications: { glp1Declared: false, glp1: [], otherMedications: '' },
  conditions: { conditions: [], otherConditions: '' },
  consent: { granted: true, textVersion: CONSENT_TEXT_VERSION },
  ...patch,
});

async function draft(answers: DraftAnswers): Promise<string> {
  const [row] = await db
    .insert(intakes)
    .values({
      state: 'draft',
      answers,
      medicationReport: 'not_answered',
      conditionReport: 'not_answered',
      outcome: 'pending',
    })
    .returning({ id: intakes.id });
  if (row === undefined) throw new Error('the draft was not created');
  return row.id;
}

const submit = (id: string) => submitIntake(db, { intakeId: id, now: NOW, rules });

async function counts(): Promise<Record<string, number>> {
  const tables = {
    patients,
    intakes,
    consent_events: consentEvents,
    evaluations: eligibilityEvaluations,
    audit_entries: auditEntries,
    normalisation_records: normalisationRecords,
    review_items: reviewItems,
  };
  const out: Record<string, number> = {};
  for (const [name, table] of Object.entries(tables)) {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
    out[name] = row?.n ?? 0;
  }
  return out;
}

// ADR-0017: the day an intake is measured against is the clinic's day. Getting this wrong does not
// merely mis-date a row — an 18th birthday read a day early is `age_below_minimum`, which
// `rules/v1.json` lists under `precedence.absolute_rejects`, so no doctor can approve the intake
// afterwards (ADR-0014 item 5).
describe('the day a submission is measured against', () => {
  // 22:30 UTC in July is 00:30 the next morning in Amsterdam.
  const JUST_AFTER_LOCAL_MIDNIGHT = new Date('2026-07-14T22:30:00Z');
  const EIGHTEENTH_BIRTHDAY_IS_15_JULY = '2008-07-15';

  it('treats a patient whose 18th birthday is the clinic’s today as 18, not 17', async () => {
    const id = await draft(
      complete({
        identity: {
          fullName: 'Tess Jansen',
          email: 't@example.com',
          dob: EIGHTEENTH_BIRTHDAY_IS_15_JULY,
        },
      }),
    );

    const outcome = await submitIntake(db, { intakeId: id, now: JUST_AFTER_LOCAL_MIDNIGHT, rules });

    expect(outcome.kind).toBe('submitted');
    if (outcome.kind !== 'submitted') return;
    expect(outcome.result.inputs.ageYears).toBe(18);
    expect(outcome.result.reasons.join('; ')).not.toContain('under the minimum age');
    expect(outcome.state).not.toBe('auto_rejected');
  });

  it('stamps the clinic’s day on the intake and the patient, not the UTC one', async () => {
    const id = await draft(complete());

    await submitIntake(db, { intakeId: id, now: JUST_AFTER_LOCAL_MIDNIGHT, rules });

    const [intake] = await db.select().from(intakes).where(eq(intakes.id, id));
    expect(intake?.submittedAt).toBe('2026-07-15');
    const [patient] = await db.select().from(patients);
    expect(patient?.signupDate).toBe('2026-07-15');
  });

  it('keeps the consent event as the instant it happened, not the day', async () => {
    const id = await draft(complete());

    await submitIntake(db, { intakeId: id, now: JUST_AFTER_LOCAL_MIDNIGHT, rules });

    const [event] = await db.select().from(consentEvents);
    expect(event?.at).toEqual(JUST_AFTER_LOCAL_MIDNIGHT);
  });
});

describe('the consent gate (ADR-0015 item 4)', () => {
  it.each([
    ['absent', {}],
    ['not granted', { consent: { granted: false, textVersion: CONSENT_TEXT_VERSION } }],
    ['of an older text version', { consent: { granted: true, textVersion: 'v2' } }],
  ])('refuses a submission whose consent is %s, and writes nothing', async (_name, patch) => {
    const answers = complete();
    const without = { ...answers, ...(patch as Partial<DraftAnswers>) };
    if (Object.keys(patch).length === 0) delete (without as { consent?: unknown }).consent;
    const id = await draft(without);
    const before = await counts();

    const outcome = await submit(id);

    expect(outcome.kind).toBe('invalid');
    expect(await counts()).toEqual(before);
    const [after] = await db.select().from(intakes).where(eq(intakes.id, id));
    expect(after?.state).toBe('draft');
    expect(after?.patientId).toBeNull();
  });

  it('names consent in the issue the patient is shown', async () => {
    const answers = complete();
    delete (answers as { consent?: unknown }).consent;
    const outcome = await submit(await draft(answers));
    if (outcome.kind !== 'invalid') throw new Error('expected an invalid submission');
    expect(outcome.issues.map((issue) => issue.path)).toContain('consent');
  });
});

describe('a complete submission', () => {
  it('writes the patient, the intake, the evaluation, the consent event and the audit trail', async () => {
    const id = await draft(complete());

    const outcome = await submit(id);
    if (outcome.kind !== 'submitted') throw new Error(`expected a submission, got ${outcome.kind}`);

    expect(outcome.state).toBe('auto_cleared');
    expect(outcome.result.outcome).toBe('auto_cleared');

    const [patient] = await db.select().from(patients).where(eq(patients.id, outcome.patientId));
    expect(patient).toMatchObject({
      fullName: 'Sem de Boer',
      email: 'sem@example.com',
      dob: '1986-04-02',
      status: 'prospect',
      sex: 'unknown',
      bsnCheck: 'absent',
      signupDate: '2026-09-13',
      source: 'intake_form',
      createdByRun: null,
      createdFromLegacyId: null,
    });
    // The new flow has one source for the metrics — this submission — and it is the intake's.
    expect(patient?.weightKg).toBeNull();
    expect(patient?.heightCm).toBeNull();

    const [intake] = await db.select().from(intakes).where(eq(intakes.id, id));
    expect(intake).toMatchObject({
      state: 'auto_cleared',
      patientId: outcome.patientId,
      submittedAt: '2026-09-13',
      weightKg: '101.0',
      heightCm: 180,
      medicationReport: 'none_reported',
      conditionReport: 'none_reported',
      outcome: 'pending',
      rulesetVersion: 'v1',
      questionnaireVersionLabel: INTAKE_FORM_VERSION,
      // An intake the new flow created has no exported key and no import run (ADR-0015 item 1).
      intakeId: null,
      createdByRun: null,
      legacyPatientId: null,
      medsCurrentRaw: null,
      conditionsRaw: null,
    });
    expect(intake?.answers).toEqual(complete());

    const evaluations = await db
      .select()
      .from(eligibilityEvaluations)
      .where(eq(eligibilityEvaluations.intakeId, id));
    expect(evaluations).toHaveLength(1);
    expect(evaluations[0]).toMatchObject({
      shadow: false,
      engineOutcome: 'auto_cleared',
      rulesetVersion: 'v1',
      matched: [],
      importRunId: null,
    });
    expect(evaluations[0]?.inputs).toMatchObject({ ageYears: 40, glp1Declared: false });

    const events = await db
      .select()
      .from(consentEvents)
      .where(eq(consentEvents.patientId, outcome.patientId));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'data_processing',
      action: 'granted',
      version: CONSENT_TEXT_VERSION,
      at: NOW,
      sourceLine: null,
      importRunId: null,
    });

    const states = await db
      .select()
      .from(consentStates)
      .where(eq(consentStates.patientId, outcome.patientId));
    expect(states).toMatchObject([{ type: 'data_processing', state: 'granted' }]);
  });

  it('records the transitions in the order they happened, with the ruleset that decided', async () => {
    const id = await draft(complete());
    const outcome = await submit(id);
    if (outcome.kind !== 'submitted') throw new Error('expected a submission');

    const entries = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.entityId, id))
      .orderBy(auditEntries.seq);
    expect(entries.map((e) => [e.actor, e.fromState, e.toState, e.rulesetVersion])).toEqual([
      ['intake form', 'draft', 'submitted', null],
      ['eligibility engine', 'submitted', 'auto_cleared', 'v1'],
    ]);
    // The engine's own explanation, so the timeline reads without joining the evaluation (R-B9).
    expect(entries[1]?.reason).toBe('cleared: no rejecting or flagging rule matched');

    const [forPatient] = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.entityId, outcome.patientId));
    expect(forPatient).toMatchObject({
      actor: 'intake form',
      entityType: 'patient',
      // A patient has no state in the machine; both null says something happened, nothing moved.
      fromState: null,
      toState: null,
    });
  });

  it('records what it changed about what the patient typed (R-A7)', async () => {
    const id = await draft(
      complete({
        identity: { fullName: '  Sem de Boer ', email: 'SEM@Example.com', dob: '1986-04-02' },
      }),
    );
    const outcome = await submit(id);
    if (outcome.kind !== 'submitted') throw new Error('expected a submission');

    const records = await db
      .select()
      .from(normalisationRecords)
      .where(eq(normalisationRecords.entityId, outcome.patientId));
    expect(
      records.map((r) => [r.entityType, r.field, r.fromValue, r.toValue, r.ruleCode]).sort(),
    ).toEqual(
      [
        ['patient', 'full_name', '  Sem de Boer ', 'Sem de Boer', 'WHITESPACE_TRIM'],
        ['patient', 'email', 'SEM@Example.com', 'sem@example.com', 'EMAIL_LOWERCASE'],
      ].sort(),
    );

    const [patient] = await db.select().from(patients).where(eq(patients.id, outcome.patientId));
    expect(patient).toMatchObject({ fullName: 'Sem de Boer', email: 'sem@example.com' });
    // The raw answers keep what was typed: the record explains the difference between the two.
    const [intake] = await db.select().from(intakes).where(eq(intakes.id, id));
    expect(intake?.answers?.identity?.email).toBe('SEM@Example.com');
  });

  it('refuses to be submitted twice', async () => {
    const id = await draft(complete());
    await submit(id);
    expect(await submit(id)).toMatchObject({ kind: 'not_draft', state: 'auto_cleared' });
  });
});

describe('the engine’s verdict becomes the state', () => {
  it.each([
    [
      'auto_rejected',
      { identity: { fullName: 'Jonge Jan', email: 'jan@example.com', dob: '2010-01-01' } },
    ],
    [
      'auto_flagged',
      { medications: { glp1Declared: true, glp1: ['semaglutide'], otherMedications: '' } },
    ],
    ['auto_cleared', {}],
  ])('lands a %s submission in that state', async (state, patch) => {
    const outcome = await submit(await draft(complete(patch)));
    if (outcome.kind !== 'submitted') throw new Error(`expected a submission, got ${outcome.kind}`);
    expect(outcome.state).toBe(state);
    const [intake] = await db.select().from(intakes).where(eq(intakes.id, outcome.intakeId));
    expect(intake?.state).toBe(state);
  });
});

describe('the detectors (ADR-0015 item 7)', () => {
  it('raises POSSIBLE_EXISTING_PATIENT on a matching email without blocking the intake', async () => {
    await db.insert(patients).values({
      fullName: 'S. de Boer',
      email: 'sem@example.com',
      dob: '1986-04-02',
      sex: 'unknown',
      bsnCheck: 'absent',
      status: 'active',
    });
    const id = await draft(complete());

    const outcome = await submit(id);
    if (outcome.kind !== 'submitted') throw new Error('expected a submission');

    // The patient is not blocked and not merged: the intake went all the way through the machine.
    expect(outcome.state).toBe('auto_cleared');
    expect(outcome.reviewItems).toBe(1);

    const items = await db.select().from(reviewItems);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'identity_conflict',
      scope: 'row',
      status: 'open',
      patientId: outcome.patientId,
      createdByRun: null,
    });
    expect(ruleOf(items[0]?.dedupeKey ?? '')).toBe('POSSIBLE_EXISTING_PATIENT');
    expect(items[0]?.reason).toContain('email');

    const [patient] = await db.select().from(patients).where(eq(patients.id, outcome.patientId));
    expect(patient?.mergedInto).toBeNull();
    expect(await db.select().from(patients)).toHaveLength(2);
  });

  it('raises nothing when no key matches', async () => {
    await db.insert(patients).values({
      fullName: 'Someone Else',
      email: 'else@example.com',
      dob: '1975-06-06',
      sex: 'unknown',
      bsnCheck: 'absent',
      status: 'active',
    });
    const outcome = await submit(await draft(complete()));
    expect(outcome).toMatchObject({ kind: 'submitted', reviewItems: 0 });
  });

  it('flags a declared GLP-1 the ruleset does not know, and asks the ruleset about the name', async () => {
    const medications = {
      glp1Declared: true,
      glp1: [],
      otherMedications: 'Retatrutide 4mg',
    };
    const outcome = await submit(await draft(complete({ medications })));
    if (outcome.kind !== 'submitted') throw new Error('expected a submission');

    // The declaration alone flags it: a patient who says they take a GLP-1 is never cleared.
    expect(outcome.state).toBe('auto_flagged');
    expect(outcome.result.reasons).toContain(
      'flagged: current GLP-1 medication (declared by patient)',
    );

    const items = await db.select().from(reviewItems);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'vocabulary',
      scope: 'vocabulary',
      // A vocabulary decision hangs on the term list, not on the patient who triggered it.
      patientId: null,
      intakeId: null,
    });
    expect(ruleOf(items[0]?.dedupeKey ?? '')).toBe('NEW_GLP1_DECLARED_UNMATCHED');
    expect(items[0]?.payload).toMatchObject({ folded: 'retatrutide 4mg', term_list: 'glp1_terms' });
  });

  it('asks once however many patients name the same drug, and again for a different one', async () => {
    // Distinct people: two submissions from the same person would also (correctly) raise a
    // POSSIBLE_EXISTING_PATIENT item, which is a different detector and a different question.
    const naming = (who: string, drug: string): DraftAnswers =>
      complete({
        identity: { fullName: who, email: `${who.toLowerCase()}@example.com`, dob: '1986-04-02' },
        medications: { glp1Declared: true, glp1: [], otherMedications: drug },
      });

    await submit(await draft(naming('Ada', 'Retatrutide 4mg')));
    await submit(await draft(naming('Bram', 'retatrutide  4MG')));
    expect(await db.select().from(reviewItems)).toHaveLength(1);

    await submit(await draft(naming('Cato', 'Survodutide')));
    expect(await db.select().from(reviewItems)).toHaveLength(2);
  });

  it('asks nothing when the ruleset recognised what the patient named', async () => {
    const outcome = await submit(
      await draft(
        complete({
          medications: { glp1Declared: true, glp1: [], otherMedications: 'Ozempic 0,5 mg' },
        }),
      ),
    );
    if (outcome.kind !== 'submitted') throw new Error('expected a submission');
    expect(outcome.state).toBe('auto_flagged');
    expect(outcome.result.reasons).toContain('flagged: current GLP-1 medication (Ozempic 0,5 mg)');
    expect(await db.select().from(reviewItems)).toHaveLength(0);
  });
});
