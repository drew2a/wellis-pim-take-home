// The plausibility detector of ADR-0005, and the debt ADR-0009 item 2 recorded: the mapper nulls
// a weight or a height outside the bounds in `rules/v1.json` with `IMPLAUSIBLE_TO_NULL`, and this
// module raises the matching review item, so a nulled value is never a resolved value.
//
// Layer 2 of ADR-0005: a detector reads canonical data and creates items. It never writes a
// canonical value, and its proposal is data on the item that only a human applies.
import type { Rules } from '@/rules/schema';

import type { MappedIntake } from '../mapper/intake';
import type { MappedPatient } from '../mapper/patient';
import type { Flag } from '../mapper/types';
import { dedupeKey, type ReviewItemDraft } from '../review/items';
import type { Ids } from '../review/mapping-items';

type Bounds = Rules['plausibility']['weight_kg'];
type Field = 'weight_kg' | 'height_cm';

/**
 * The single ×10 or ×100 reading that lands inside the bounds (`15` → 150, `7.8` → 78), and none
 * when zero or two do: a proposal a reviewer cannot check at a glance is worse than no proposal
 * (ADR-0005). Only shifts upwards, because every implausible value in this export is too small;
 * a value too large to be a person is a different question and gets no guess.
 */
export function decimalShift(value: number, bounds: Bounds): number | null {
  const landing = [10, 100]
    .map((factor) => value * factor)
    .filter((shifted) => shifted >= bounds.min && shifted <= bounds.max);
  return landing.length === 1 ? (landing[0] as number) : null;
}

interface ImplausibleValue {
  readonly entity: 'legacy_patient' | 'legacy_intake';
  readonly id: string;
  readonly field: Field;
  readonly raw: string;
  readonly value: number;
}

const implausible = (flags: readonly Flag[]): Extract<Flag, { kind: 'implausible' }>[] =>
  flags.filter(
    (flag): flag is Extract<Flag, { kind: 'implausible' }> => flag.kind === 'implausible',
  );

export interface PlausibilityInput {
  readonly patients: readonly MappedPatient[];
  readonly intakes: readonly MappedIntake[];
  readonly bounds: Rules['plausibility'];
}

/**
 * One item per patient and field, covering that patient's own value and its intakes' values for
 * the same field: the decision — is this a decimal shift, a typo, or a real measurement? — is one
 * decision per person, not one per row (`CLAUDE.md` §5). An intake whose patient does not exist
 * has no patient to hang the item on and gets its own (ADR-0011 item 10).
 */
export function plausibilityItems(input: PlausibilityInput, ids: Ids): ReviewItemDraft[] {
  const known = new Set(input.patients.map((patient) => patient.legacyId));
  const byOwner = new Map<string, ImplausibleValue[]>();
  const add = (owner: string, value: ImplausibleValue): void => {
    byOwner.set(`${owner}|${value.field}`, [
      ...(byOwner.get(`${owner}|${value.field}`) ?? []),
      value,
    ]);
  };

  for (const patient of input.patients) {
    for (const flag of implausible(patient.flags)) {
      add(patient.legacyId, {
        entity: 'legacy_patient',
        id: patient.legacyId,
        field: flag.field,
        raw: flag.raw,
        value: flag.value,
      });
    }
  }
  for (const intake of input.intakes) {
    const owner = known.has(intake.legacyPatientId) ? intake.legacyPatientId : intake.intakeId;
    for (const flag of implausible(intake.flags)) {
      add(owner, {
        entity: 'legacy_intake',
        id: intake.intakeId,
        field: flag.field,
        raw: flag.raw,
        value: flag.value,
      });
    }
  }

  return [...byOwner.entries()]
    .map(([key, values]) => buildItem(key, values, input.bounds, ids, known))
    .sort((a, b) => (a.dedupeKey < b.dedupeKey ? -1 : 1));
}

function buildItem(
  key: string,
  values: readonly ImplausibleValue[],
  bounds: Rules['plausibility'],
  ids: Ids,
  known: ReadonlySet<string>,
): ReviewItemDraft {
  const owner = key.slice(0, key.lastIndexOf('|'));
  const field = key.slice(key.lastIndexOf('|') + 1) as Field;
  const limits = field === 'weight_kg' ? bounds.weight_kg : bounds.height_cm;
  const onPatient = known.has(owner);
  const withProposals = values.map((value) => ({
    entity: value.entity,
    id: value.id,
    raw: value.raw,
    value: value.value,
    proposed_value: proposalText(decimalShift(value.value, limits), field),
  }));
  // The item's own field is the patient's, so the proposal on it is about the patient's value;
  // an intake's proposal travels in the payload, next to the value it belongs to.
  const own = withProposals.find(
    (value) => value.entity === (onPatient ? 'legacy_patient' : 'legacy_intake'),
  );
  const raws = values.map((value) => value.raw).sort();

  return {
    type: 'data_quality',
    scope: 'row',
    title: `${field} outside the plausible range`,
    reason:
      `${values.length} value(s) outside ${limits.min}–${limits.max}; each was stored null and ` +
      'the raw row keeps what the export said',
    payload: {
      [onPatient ? 'legacy_id' : 'intake_id']: owner,
      field,
      bounds: limits,
      values: withProposals,
      note: onPatient
        ? "the patient's own value and every intake value of theirs for this field"
        : 'the intake references a patient that does not exist (ADR-0006), so the item is its own',
    },
    proposedResolution:
      own?.proposed_value === null || own === undefined
        ? null
        : {
            field,
            proposed_value: own.proposed_value,
            rule: 'DECIMAL_SHIFT',
            evidence: { bounds: limits, raw: own.raw, shifted_from: own.value },
          },
    patientId: onPatient ? (ids.patients.get(owner) ?? null) : null,
    intakeId: onPatient ? null : (ids.intakes.get(owner) ?? null),
    field,
    dedupeKey: dedupeKey([
      'data_quality',
      'row',
      `${onPatient ? 'legacy_patient' : 'legacy_intake'}:${owner}`,
      field,
      'IMPLAUSIBLE_TO_NULL',
      raws.join(','),
    ]),
  };
}

/** Heights are whole centimetres; weights carry one decimal, as the column stores them. */
function proposalText(shifted: number | null, field: Field): string | null {
  if (shifted === null) return null;
  return field === 'height_cm' ? String(Math.round(shifted)) : shifted.toFixed(1);
}
