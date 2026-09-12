// One legacy intake row to its canonical row (ADR-0004 `intakes`). The legacy outcome becomes a
// terminal legacy state outside the Part B state machine (ADR-0005); the audit entry for it is
// written by the canonical load, not here.
import type { IntakeColumn } from '../source/layout';
import { mapDate } from './dates';
import { mapConditionReport, mapMedicationReport, type HistoryReport } from './history-report';
import { mapAlcoholUnits, mapHeight, mapIntakeWeight } from './numbers';
import { collect, emptyToNull, type MappingContext } from './patient';
import type { Flag, RecordDraft } from './types';
import {
  OUTCOME,
  QUESTIONNAIRE_VERSION,
  mapVocabulary,
  type Outcome,
  type QuestionnaireVersion,
} from './vocabulary';

export type RawIntake = Readonly<Record<IntakeColumn, string>>;

export type LegacyState = 'legacy_approved' | 'legacy_rejected' | 'legacy_pending';

export interface CanonicalIntake {
  readonly submittedAt: string | null;
  readonly questionnaireVersionLabel: string | null;
  readonly questionnaireVersion: QuestionnaireVersion | null;
  readonly weightKg: string | null;
  readonly heightCm: number | null;
  readonly medsCurrentRaw: string | null;
  readonly medicationReport: HistoryReport;
  readonly conditionsRaw: string | null;
  readonly conditionReport: HistoryReport;
  readonly alcoholUnitsWeek: number | null;
  readonly outcome: Outcome;
  readonly outcomeRaw: string;
  readonly reviewerNote: string | null;
  readonly state: LegacyState;
}

export interface MappedIntake {
  readonly intakeId: string;
  readonly legacyPatientId: string;
  readonly canonical: CanonicalIntake;
  readonly records: readonly RecordDraft[];
  readonly flags: readonly Flag[];
}

// An unseen outcome spelling is `unknown` until its vocabulary item is resolved; the intake sits
// in the one non-terminal legacy state meanwhile (ADR-0009 item 8).
const STATE_FOR_OUTCOME: Record<Outcome, LegacyState> = {
  approved: 'legacy_approved',
  rejected: 'legacy_rejected',
  pending: 'legacy_pending',
  unknown: 'legacy_pending',
};

export function mapIntake(raw: RawIntake, context: MappingContext): MappedIntake {
  const records: RecordDraft[] = [];
  const flags: Flag[] = [];
  const take = collect(records, flags);
  const { plausibility } = context.rules;

  const outcome = take(mapVocabulary(raw.outcome, OUTCOME));

  return {
    intakeId: raw.intake_id,
    legacyPatientId: raw.legacy_patient_id,
    canonical: {
      submittedAt: take(mapDate(raw.submitted_at, 'submitted_at', { asOf: context.asOf })),
      questionnaireVersionLabel: emptyToNull(raw.questionnaire_version),
      questionnaireVersion: take(mapVocabulary(raw.questionnaire_version, QUESTIONNAIRE_VERSION)),
      weightKg: take(mapIntakeWeight(raw.weight, plausibility.weight_kg)),
      heightCm: take(mapHeight(raw.height, plausibility.height_cm)),
      medsCurrentRaw: emptyToNull(raw.meds_current),
      medicationReport: take(mapMedicationReport(raw.meds_current)),
      conditionsRaw: emptyToNull(raw.conditions),
      conditionReport: take(mapConditionReport(raw.conditions)),
      alcoholUnitsWeek: take(mapAlcoholUnits(raw.alcohol_units_week)),
      outcome,
      outcomeRaw: raw.outcome,
      reviewerNote: emptyToNull(raw.reviewer_note),
      state: STATE_FOR_OUTCOME[outcome],
    },
    records,
    flags,
  };
}
