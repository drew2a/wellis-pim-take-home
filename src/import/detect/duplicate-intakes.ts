// Two intakes from one patient on one day (ADR-0006): 5 pairs in this export, 3 with consecutive
// intake ids, weights 1 to 3 kg apart, and outcomes that disagree in 3 of them. Both intakes are
// kept with their legacy outcome and state; neither is the outcome of record until a reviewer
// decides, so the item proposes nothing.
import type { MappedIntake } from '../mapper/intake';
import { dedupeKey, type ReviewItemDraft } from '../review/items';
import type { Ids } from '../review/mapping-items';

/** The fields a reviewer compares to tell a double submission from two real visits. */
function side(intake: MappedIntake): Record<string, unknown> {
  const { canonical } = intake;
  return {
    intake_id: intake.intakeId,
    submitted_at: canonical.submittedAt,
    questionnaire_version: canonical.questionnaireVersionLabel,
    weight_kg: canonical.weightKg,
    height_cm: canonical.heightCm,
    meds_current: canonical.medsCurrentRaw,
    conditions: canonical.conditionsRaw,
    alcohol_units_week: canonical.alcoholUnitsWeek,
    outcome: canonical.outcome,
    outcome_raw: canonical.outcomeRaw,
    reviewer_note: canonical.reviewerNote,
    state: canonical.state,
  };
}

/**
 * The dates one intake could plausibly carry: the reading under the separator convention and the
 * reading the convention would give if it were wrong. Two intakes are on the same day when those
 * sets meet, which is how the profile counts the pairs (P-27) and is deliberately wider than the
 * convention alone: a pair whose dates agree only under the alternative reading is exactly the
 * kind of thing a human should see, and the convention itself is still an open question.
 */
function readings(intake: MappedIntake): string[] {
  // The date the row carries, even where the mapper nulled it as impossible: two intakes that
  // both say 2062-01-25 are still one patient submitting twice on one day, and it is the date
  // they share, not its plausibility, that makes them a pair. That patient's shifted record is a
  // separate item of its own (findings, signup_date).
  const impossible = intake.flags.find(
    (flag) => flag.kind === 'date_impossible' && flag.field === 'submitted_at',
  );
  const read =
    intake.canonical.submittedAt ??
    (impossible?.kind === 'date_impossible' ? impossible.read : null);
  return [read, intake.submittedAtAlternative].filter((value): value is string => value !== null);
}

export function duplicateIntakeItems(
  intakes: readonly MappedIntake[],
  ids: Ids,
): ReviewItemDraft[] {
  const byDay = new Map<string, MappedIntake[]>();
  for (const intake of intakes) {
    for (const reading of readings(intake)) {
      const key = `${intake.legacyPatientId}|${reading}`;
      byDay.set(key, [...(byDay.get(key) ?? []), intake]);
    }
  }

  const seen = new Set<string>();
  return (
    [...byDay.entries()]
      .filter(([, group]) => group.length > 1)
      .map(([key, group]) => {
        const members = [...group].sort((a, b) => (a.intakeId < b.intakeId ? -1 : 1));
        const legacyPatientId = key.slice(0, key.lastIndexOf('|'));
        const outcomes = new Set(members.map((intake) => intake.canonical.outcome));
        return {
          type: 'duplicate_intake' as const,
          scope: 'row' as const,
          title: `${members.length} intakes from one patient on ${key.slice(key.lastIndexOf('|') + 1)}`,
          reason:
            outcomes.size > 1
              ? `the outcomes disagree: ${[...outcomes].join(' / ')}`
              : 'the outcomes agree; the submissions may still be one visit recorded twice',
          payload: {
            legacy_patient_id: legacyPatientId,
            submitted_at: key.slice(key.lastIndexOf('|') + 1),
            outcomes_disagree: outcomes.size > 1,
            intakes: members.map(side),
            actions: ['keep_one_as_the_outcome_of_record', 'keep_both'],
            note: 'both intakes are stored either way; no outcome is proposed (ADR-0006)',
          },
          proposedResolution: null,
          patientId: ids.patients.get(legacyPatientId) ?? null,
          // The item is about the pair, so it names no single intake.
          intakeId: null,
          field: null,
          dedupeKey: dedupeKey([
            'duplicate_intake',
            'row',
            `legacy_patient:${legacyPatientId}`,
            'submitted_at',
            'SAME_DAY_INTAKES',
            members.map((intake) => intake.intakeId).join(','),
          ]),
        };
      })
      // A pair whose two readings both match would otherwise be listed twice.
      .filter((item) => {
        if (seen.has(item.dedupeKey)) return false;
        seen.add(item.dedupeKey);
        return true;
      })
      .sort((a, b) => (a.dedupeKey < b.dedupeKey ? -1 : 1))
  );
}
