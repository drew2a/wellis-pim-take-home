// What a submission is (ADR-0015 item 5): one transaction that turns a draft into a patient, an
// intake, an evaluation, a consent event, three audit entries and — where a detector has something
// to say — a review item.
//
// The whole of it is one transaction because a submission is one fact. A patient without the
// intake that created them, or an intake without the evaluation that judged it, would be worse
// than a rejected request.
import { eq, or } from 'drizzle-orm';
import { z } from 'zod';

import { CONSENT_TYPE_DATA_PROCESSING } from '@/consent/text';
import { recomputeConsentStates } from '@/consent/states';
import type { Queryable } from '@/db/queryable';
import {
  auditEntries,
  consentEvents,
  eligibilityEvaluations,
  intakes,
  patients,
} from '@/db/schema';
import { evaluate } from '@/eligibility/evaluate';
import type { EligibilityResult } from '@/eligibility/types';
import { ELIGIBILITY_ENGINE_ACTOR, INTAKE_FORM_ACTOR } from '@/import/actors';
import { insertNormalisationRecords } from '@/import/canonical/records';
import type { IdentityRow } from '@/import/identity/candidates';
import { mapEmail } from '@/import/mapper/email';
import { trimWhitespace } from '@/import/mapper/text';
import type { RecordDraft } from '@/import/mapper/types';
import { insertReviewItems, type ReviewItemDraft } from '@/import/review/items';
import { dedupeKeyFor } from '@/repo/audit';
import { currentRules } from '@/rules/load';
import type { Rules } from '@/rules/schema';

import {
  conditionReportOf,
  eligibilityInputOf,
  medicationReportOf,
  submittedAnswersSchema,
  type SubmittedAnswers,
} from './answers';
import {
  possibleExistingPatientItem,
  sharedKeys,
  unmatchedGlp1Item,
  type PatientMatch,
} from './detectors';
import { stateForOutcome, type IntakeState } from './machine';
import { dayOf } from './today';
import { transitionIntake } from './transition';

const FORM = { kind: 'process', name: INTAKE_FORM_ACTOR } as const;
const ENGINE = { kind: 'process', name: ELIGIBILITY_ENGINE_ACTOR } as const;

export interface ValidationIssue {
  /** Dotted path into the answers, e.g. `metrics.weightKg`, so the form can point at the field. */
  readonly path: string;
  readonly message: string;
}

export type SubmitOutcome =
  | { readonly kind: 'not_found' }
  | { readonly kind: 'not_draft'; readonly state: IntakeState }
  | { readonly kind: 'invalid'; readonly issues: readonly ValidationIssue[] }
  | {
      readonly kind: 'submitted';
      readonly intakeId: string;
      readonly patientId: string;
      readonly state: IntakeState;
      readonly result: EligibilityResult;
      readonly reviewItems: number;
    };

const issuesOf = (error: z.ZodError): ValidationIssue[] =>
  error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));

/**
 * Everything the canonical patient row differs from what the patient typed, as normalisation
 * records (R-A7, `CLAUDE.md` §5): the same normalisers the importer uses, so the two layers cannot
 * disagree about what "canonical" means. The blanking codes cannot fire here — Zod refused at the
 * boundary what the importer had to accept — which is asserted rather than assumed.
 */
function canonicalIdentity(answers: SubmittedAnswers): {
  fullName: string;
  email: string;
  records: RecordDraft[];
} {
  const name = trimWhitespace(answers.identity.fullName, 'full_name');
  const email = mapEmail(answers.identity.email);
  if (email.value === null) {
    throw new Error(
      `the intake form accepted an email the mapper cannot store: ${answers.identity.email}`,
    );
  }
  return {
    fullName: name.value,
    email: email.value,
    records: [...name.records, ...email.records],
  };
}

/** The new patient as the duplicate detector sees it: the form supplies email and name + dob. */
const identityRowOf = (
  legacyId: string,
  fullName: string,
  email: string,
  dob: string,
): IdentityRow => ({
  legacyId,
  fullName,
  dob,
  email,
  bsn: null,
  phone: null,
  sex: 'unknown',
  city: null,
  weightKg: null,
  heightCm: null,
  status: 'prospect',
  signupDate: null,
  source: 'intake_form',
  intakeCount: 1,
});

/**
 * Existing patients that share a candidate key with the submission. The candidate keys are
 * ADR-0006's, of which the form supplies two — canonical email, and folded name with date of birth
 * — and which key a pair actually shares is decided by `sharedKeys`, the one definition of it.
 *
 * The query narrows on the two columns a key could match; neither is indexed and the table holds a
 * few thousand rows, so this is a scan. At this size that is cheaper than the index it would save.
 */
async function findMatches(
  db: Queryable,
  newRow: IdentityRow,
  excludeId: string,
): Promise<PatientMatch[]> {
  if (newRow.dob === null) throw new Error('a submitted intake always carries a date of birth');
  const rows = await db
    .select()
    .from(patients)
    .where(or(eq(patients.email, newRow.email ?? ''), eq(patients.dob, newRow.dob)));
  return rows
    .filter((row) => row.id !== excludeId)
    .map((row) => ({
      patientId: row.id,
      mergedInto: row.mergedInto,
      row: {
        // A patient the new flow created has no legacy id; its uuid names it (ADR-0009 item 3).
        legacyId: row.createdFromLegacyId ?? row.id,
        fullName: row.fullName,
        dob: row.dob,
        email: row.email,
        bsn: row.bsn,
        phone: row.phone,
        sex: row.sex,
        city: row.city,
        weightKg: row.weightKg,
        heightCm: row.heightCm,
        status: row.status,
        signupDate: row.signupDate,
        source: row.source,
        intakeCount: 0,
      },
    }))
    .filter((match) => sharedKeys(newRow, match.row).length > 0);
}

export interface SubmitOptions {
  readonly intakeId: string;
  /**
   * The submission instant. The consent event keeps it as an instant; age, the signup date and
   * `submitted_at` are the clinic's calendar day containing it (ADR-0017).
   */
  readonly now: Date;
  readonly rules?: Rules;
}

export async function submitIntake(db: Queryable, options: SubmitOptions): Promise<SubmitOutcome> {
  const rules = options.rules ?? currentRules();
  const todayIso = dayOf(options.now);

  return db.transaction(async (tx) => {
    const [intake] = await tx
      .select({ id: intakes.id, state: intakes.state, answers: intakes.answers })
      .from(intakes)
      .where(eq(intakes.id, options.intakeId))
      .for('update');
    if (intake === undefined) return { kind: 'not_found' };
    if (intake.state !== 'draft') return { kind: 'not_draft', state: intake.state };

    // Validated again at submit whatever the draft already held: a step may have been saved under
    // an older ruleset or an older form version (`CLAUDE.md` §2).
    const parsed = submittedAnswersSchema({ rules, todayIso }).safeParse(intake.answers);
    if (!parsed.success) return { kind: 'invalid', issues: issuesOf(parsed.error) };
    const answers: SubmittedAnswers = parsed.data;

    const identity = canonicalIdentity(answers);
    const [patient] = await tx
      .insert(patients)
      .values({
        fullName: identity.fullName,
        email: identity.email,
        dob: answers.identity.dob,
        sex: 'unknown',
        bsnCheck: 'absent',
        // The commercial standing of someone who has not bought anything yet (`CLAUDE.md` §6).
        status: 'prospect',
        signupDate: todayIso,
        source: 'intake_form',
        // `weight_kg` and `height_cm` stay null: the new flow has exactly one source for them —
        // this submission — and copying it onto the patient would create a second value that can
        // drift from the intake's with no event between them (ADR-0015 item 5).
      })
      .returning({ id: patients.id });
    if (patient === undefined) throw new Error('the patient row was not written');

    await insertNormalisationRecords(tx, null, [
      { entityType: 'patient', entityId: patient.id, records: identity.records },
    ]);

    // Not a transition: an intake's states are the machine's, a patient has none. Both states null
    // says something happened without claiming anything moved (ADR-0015 item 5).
    const patientReason = `patient created by the intake form from intake ${options.intakeId}`;
    await tx.insert(auditEntries).values({
      actor: INTAKE_FORM_ACTOR,
      entityType: 'patient',
      entityId: patient.id,
      fromState: null,
      toState: null,
      reason: patientReason,
      dedupeKey: dedupeKeyFor(INTAKE_FORM_ACTOR, 'patient', patient.id, null, null, patientReason),
    });

    const result = evaluate(eligibilityInputOf(answers, todayIso), rules);
    const state = stateForOutcome(result.outcome);

    await tx
      .update(intakes)
      .set({
        patientId: patient.id,
        submittedAt: todayIso,
        questionnaireVersionLabel: answers.formVersion,
        weightKg: String(answers.metrics.weightKg),
        heightCm: answers.metrics.heightCm,
        medicationReport: medicationReportOf(answers),
        conditionReport: conditionReportOf(answers),
        // The medical result, which stays open until a human decides it (`CLAUDE.md` §6).
        outcome: 'pending',
        rulesetVersion: result.rulesetVersion,
      })
      .where(eq(intakes.id, options.intakeId));

    await tx.insert(eligibilityEvaluations).values({
      intakeId: options.intakeId,
      rulesetVersion: result.rulesetVersion,
      engineOutcome: result.outcome,
      reasons: [...result.reasons],
      matched: [...result.matched],
      inputs: result.inputs,
      // Not a shadow row: this is what the patient was told at submission (ADR-0011 item 2).
      shadow: false,
    });

    await transitionIntake(tx, {
      intakeId: options.intakeId,
      to: 'submitted',
      actor: FORM,
      reason: 'submitted through the intake form',
    });
    await transitionIntake(tx, {
      intakeId: options.intakeId,
      to: state,
      actor: ENGINE,
      // The engine's own explanation, verbatim, so the timeline explains itself (R-B9).
      reason: result.reasons.join('; '),
      rulesetVersion: result.rulesetVersion,
    });

    // The log is evidence; the state is what we act on (`CLAUDE.md` §6). The event carries the
    // version of the text the patient actually agreed to (ADR-0015 item 4).
    await tx.insert(consentEvents).values({
      patientId: patient.id,
      type: CONSENT_TYPE_DATA_PROCESSING,
      action: 'granted',
      at: options.now,
      version: answers.consent.textVersion,
    });
    await recomputeConsentStates(tx, {
      declaredTypes: [CONSENT_TYPE_DATA_PROCESSING],
      survivorIds: [patient.id],
    });

    const drafts = await detect(tx, {
      answers,
      patientId: patient.id,
      intakeId: options.intakeId,
      identity,
      result,
    });
    const reviewItems = await insertReviewItems(tx, null, drafts);

    return {
      kind: 'submitted',
      intakeId: options.intakeId,
      patientId: patient.id,
      state,
      result,
      reviewItems,
    };
  });
}

/** The two detectors of ADR-0015 item 7. Neither blocks; both hand a human a decision. */
async function detect(
  db: Queryable,
  input: {
    answers: SubmittedAnswers;
    patientId: string;
    intakeId: string;
    identity: { fullName: string; email: string };
    result: EligibilityResult;
  },
): Promise<ReviewItemDraft[]> {
  const drafts: ReviewItemDraft[] = [];

  const row = identityRowOf(
    input.patientId,
    input.identity.fullName,
    input.identity.email,
    input.answers.identity.dob,
  );
  const matches = await findMatches(db, row, input.patientId);
  const duplicate = possibleExistingPatientItem(input.patientId, row, matches);
  if (duplicate !== null) drafts.push(duplicate);

  // The patient reported current GLP-1 use and the ruleset recognised nothing they named. The
  // intake is flagged either way (item 6); this asks the ruleset whether to learn the name.
  const { glp1Declared, otherMedications } = input.answers.medications;
  if (glp1Declared && input.result.inputs.glp1.length === 0 && otherMedications.trim() !== '') {
    drafts.push(unmatchedGlp1Item(otherMedications, input.intakeId, input.result.rulesetVersion));
  }
  return drafts;
}
