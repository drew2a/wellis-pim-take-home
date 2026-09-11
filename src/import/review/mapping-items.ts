// Review items the mapping table itself asks for (ADR-0005; the brief's item 5): the row-level
// facts the mapper flagged, one vocabulary item per unseen value or open question, and the two
// bookkeeping cases of ADR-0004 (a changed source row, a human-owned field the mapping would now
// change). Detector items (plausibility, weight unit, consent state, identity) belong to the
// detectors branch and are not built here.
import { RULE_CODES } from '../mapper/rule-codes';
import type { MappedConsentEvent } from '../mapper/consent-event';
import type { MappedIntake } from '../mapper/intake';
import type { MappedPatient } from '../mapper/patient';
import type { Flag } from '../mapper/types';
import type { HumanOwnedConflict } from '../canonical/human-owned';
import type { ChangedRawRow, RepeatedRawRow } from '../raw/load';
import { dedupeKey, type ReviewItemDraft } from './items';

export interface Ids {
  /** legacy_id -> patients.id */
  readonly patients: ReadonlyMap<string, string>;
  /** intake_id -> intakes.id */
  readonly intakes: ReadonlyMap<string, string>;
}

const rowItem = (
  draft: Omit<ReviewItemDraft, 'scope' | 'reason' | 'proposedResolution'> &
    Partial<Pick<ReviewItemDraft, 'reason' | 'proposedResolution'>>,
): ReviewItemDraft => ({
  scope: 'row',
  reason: null,
  proposedResolution: null,
  ...draft,
});

// ---------------------------------------------------------------------------------------------
// Row-level items from patient flags
// ---------------------------------------------------------------------------------------------

export function patientFlagItems(patient: MappedPatient, ids: Ids): ReviewItemDraft[] {
  const patientId = ids.patients.get(patient.legacyId) ?? null;
  const entity = `legacy_patient:${patient.legacyId}`;
  const items: ReviewItemDraft[] = [];
  for (const flag of patient.flags) {
    const key = (rule: string): string =>
      dedupeKey(['data_quality', 'row', entity, flag.field, rule, flag.raw]);
    switch (flag.kind) {
      case 'email_placeholder':
        items.push(
          rowItem({
            type: 'data_quality',
            title: 'email missing, placeholder typed',
            payload: { legacy_id: patient.legacyId, raw: flag.raw, canonical: null },
            patientId,
            intakeId: null,
            field: 'email',
            dedupeKey: key('EMAIL_PLACEHOLDER_TO_NULL'),
          }),
        );
        break;
      case 'email_internal_space':
        items.push(
          rowItem({
            type: 'data_quality',
            title: 'email contains a space',
            payload: { legacy_id: patient.legacyId, raw: flag.raw, canonical: null },
            proposedResolution: {
              field: 'email',
              proposed_value: flag.proposed,
              rule: 'EMAIL_INTERNAL_SPACE_REMOVED',
              evidence: RULE_CODES.EMAIL_INTERNAL_SPACE_TO_NULL,
            },
            patientId,
            intakeId: null,
            field: 'email',
            dedupeKey: key('EMAIL_INTERNAL_SPACE_TO_NULL'),
          }),
        );
        break;
      case 'date_impossible':
        if (flag.field === 'dob') {
          items.push(
            rowItem({
              type: 'data_quality',
              title: 'date of birth is impossible',
              reason: flag.reason,
              payload: {
                legacy_id: patient.legacyId,
                raw: flag.raw,
                read: flag.read,
                reason: flag.reason,
                signup_date: patient.canonical.signupDate,
              },
              patientId,
              intakeId: null,
              field: 'dob',
              dedupeKey: key('DATE_IMPOSSIBLE_TO_NULL'),
            }),
          );
        }
        // signup_date: built by shiftedPatientItem with the patient's whole record.
        break;
      case 'date_unreadable':
        items.push(
          rowItem({
            type: 'data_quality',
            title: `${flag.field} is not a date in a known shape`,
            payload: { legacy_id: patient.legacyId, raw: flag.raw },
            patientId,
            intakeId: null,
            field: flag.field,
            dedupeKey: key('DATE_UNREADABLE_TO_NULL'),
          }),
        );
        break;
      case 'bsn_invalid':
        items.push(
          rowItem({
            type: 'data_quality',
            title: 'bsn fails the elfproef',
            payload: { legacy_id: patient.legacyId, raw: flag.raw, bsn_check: 'invalid' },
            patientId,
            intakeId: null,
            field: 'bsn',
            dedupeKey: key('ELFPROEF'),
          }),
        );
        break;
      case 'bsn_malformed':
        items.push(
          rowItem({
            type: 'data_quality',
            title: 'bsn is not nine digits',
            payload: { legacy_id: patient.legacyId, raw: flag.raw, canonical: null },
            patientId,
            intakeId: null,
            field: 'bsn',
            dedupeKey: key('BSN_MALFORMED_TO_NULL'),
          }),
        );
        break;
      case 'phone_unparsed':
        items.push(
          rowItem({
            type: 'data_quality',
            title: 'phone in an unseen form',
            payload: { legacy_id: patient.legacyId, raw: flag.raw, canonical: null },
            proposedResolution:
              flag.proposed === null
                ? null
                : {
                    field: 'phone',
                    proposed_value: flag.proposed,
                    rule: 'PHONE_E164_FROM_DIGITS',
                    evidence: RULE_CODES.PHONE_UNPARSED_TO_NULL,
                  },
            patientId,
            intakeId: null,
            field: 'phone',
            dedupeKey: key('PHONE_UNPARSED_TO_NULL'),
          }),
        );
        break;
      case 'vocabulary_unseen':
      case 'weight_unit_missing':
      case 'implausible':
      case 'non_numeric':
      case 'timestamp_unparsed':
        // Vocabulary items are aggregated across rows below; the others are detector items.
        break;
    }
  }
  return items;
}

// ---------------------------------------------------------------------------------------------
// Row-level items from intake and consent flags
// ---------------------------------------------------------------------------------------------

export function intakeFlagItems(
  intake: MappedIntake,
  ids: Ids,
  patientHasShiftedRecord: boolean,
): ReviewItemDraft[] {
  const intakeId = ids.intakes.get(intake.intakeId) ?? null;
  const patientId = ids.patients.get(intake.legacyPatientId) ?? null;
  const entity = `legacy_intake:${intake.intakeId}`;
  const items: ReviewItemDraft[] = [];
  for (const flag of intake.flags) {
    const key = (rule: string): string =>
      dedupeKey(['data_quality', 'row', entity, flag.field, rule, flag.raw]);
    if (flag.kind === 'date_impossible' && !patientHasShiftedRecord) {
      items.push(
        rowItem({
          type: 'data_quality',
          title: 'submission date is impossible',
          reason: flag.reason,
          payload: {
            intake_id: intake.intakeId,
            raw: flag.raw,
            read: flag.read,
            reason: flag.reason,
          },
          patientId,
          intakeId,
          field: 'submitted_at',
          dedupeKey: key('DATE_IMPOSSIBLE_TO_NULL'),
        }),
      );
    } else if (flag.kind === 'date_unreadable') {
      items.push(
        rowItem({
          type: 'data_quality',
          title: 'submitted_at is not a date in a known shape',
          payload: { intake_id: intake.intakeId, raw: flag.raw },
          patientId,
          intakeId,
          field: 'submitted_at',
          dedupeKey: key('DATE_UNREADABLE_TO_NULL'),
        }),
      );
    }
  }
  return items;
}

export function consentFlagItems(event: MappedConsentEvent, ids: Ids): ReviewItemDraft[] {
  const patientId = ids.patients.get(event.legacyPatientId) ?? null;
  return event.flags.flatMap((flag) =>
    flag.kind === 'timestamp_unparsed'
      ? [
          rowItem({
            type: 'data_quality',
            title: 'consent event time is unreadable; no event stored',
            payload: {
              source_line: event.lineNo,
              legacy_patient_id: event.legacyPatientId,
              raw: flag.raw,
            },
            patientId,
            intakeId: null,
            field: 'at',
            dedupeKey: dedupeKey([
              'data_quality',
              'row',
              `legacy_consent_event:${event.lineNo}`,
              'at',
              'TIMESTAMP_UNPARSED',
              flag.raw,
            ]),
          }),
        ]
      : [],
  );
}

// ---------------------------------------------------------------------------------------------
// Vocabulary items: one per unseen value, one per open question
// ---------------------------------------------------------------------------------------------

interface Occurrence {
  readonly entity: 'legacy_patient' | 'legacy_intake' | 'legacy_consent_event';
  readonly field: string;
  readonly raw: string;
  readonly key: string;
}

function occurrences(
  patients: readonly MappedPatient[],
  intakes: readonly MappedIntake[],
  consents: readonly MappedConsentEvent[],
  kinds: readonly Flag['kind'][],
): Occurrence[] {
  const pick = (entity: Occurrence['entity'], key: string, flags: readonly Flag[]): Occurrence[] =>
    flags
      .filter((f) => kinds.includes(f.kind))
      .map((f) => ({ entity, field: f.field, raw: f.raw, key }));
  return [
    ...patients.flatMap((p) => pick('legacy_patient', p.legacyId, p.flags)),
    ...intakes.flatMap((i) => pick('legacy_intake', i.intakeId, i.flags)),
    ...consents.flatMap((c) => pick('legacy_consent_event', String(c.lineNo), c.flags)),
  ];
}

/** One item per (field, raw value) not in a closed vocabulary or not a number, listing the rows. */
export function unseenValueItems(
  patients: readonly MappedPatient[],
  intakes: readonly MappedIntake[],
  consents: readonly MappedConsentEvent[],
): ReviewItemDraft[] {
  const groups = new Map<string, { entity: string; field: string; raw: string; rows: string[] }>();
  for (const o of occurrences(patients, intakes, consents, ['vocabulary_unseen', 'non_numeric'])) {
    const id = `${o.entity}|${o.field}|${o.raw}`;
    const group = groups.get(id) ?? { entity: o.entity, field: o.field, raw: o.raw, rows: [] };
    group.rows.push(o.key);
    groups.set(id, group);
  }
  return [...groups.values()].map((g) => {
    const isNumber =
      g.field === 'alcohol_units_week' || g.field === 'weight_kg' || g.field === 'height_cm';
    const title = isNumber
      ? `${g.field}: \`${g.raw}\` on ${g.rows.length} rows is not a number: zero or not answered?`
      : `${g.field}: unseen value \`${g.raw}\` on ${g.rows.length} rows`;
    return {
      type: 'vocabulary',
      scope: 'vocabulary',
      title,
      reason: null,
      payload: { entity: g.entity, field: g.field, raw: g.raw, rows: g.rows },
      proposedResolution: null,
      patientId: null,
      intakeId: null,
      field: g.field,
      dedupeKey: dedupeKey([
        'vocabulary',
        'vocabulary',
        g.entity,
        g.field,
        isNumber ? 'NON_NUMERIC_TO_NULL' : 'VOCAB_UNKNOWN',
        g.raw,
      ]),
    };
  });
}

/** The confirmation items for the inferences with their own rule codes, plus bsn retention. */
export function confirmationItems(
  patients: readonly MappedPatient[],
  intakes: readonly MappedIntake[],
): ReviewItemDraft[] {
  const byFieldRule = (
    rows: readonly { records: readonly { ruleCode: string; field: string }[] }[],
    field: string,
    code: string,
  ): number =>
    rows.reduce(
      (n, r) => n + r.records.filter((x) => x.field === field && x.ruleCode === code).length,
      0,
    );
  const idsWithRule = <T extends { records: readonly { ruleCode: string }[] }>(
    rows: readonly T[],
    code: string,
    id: (row: T) => string,
  ): string[] => rows.filter((r) => r.records.some((x) => x.ruleCode === code)).map(id);

  const vocabulary = (
    title: string,
    field: string | null,
    rule: string,
    payload: Record<string, unknown>,
  ): ReviewItemDraft => ({
    type: 'vocabulary',
    scope: 'vocabulary',
    title,
    reason: null,
    payload,
    proposedResolution: null,
    patientId: null,
    intakeId: null,
    field,
    dedupeKey: dedupeKey(['vocabulary', 'vocabulary', 'rule', field, rule, 'confirm']),
  });

  return [
    vocabulary(
      'Confirm the date separator convention (dash = D-M-Y, slash = M-D-Y)',
      null,
      'DATE_ORDER_FROM_SEPARATOR',
      {
        evidence: RULE_CODES.DATE_ORDER_FROM_SEPARATOR,
        rows_converted: {
          dob: byFieldRule(patients, 'dob', 'DATE_ORDER_FROM_SEPARATOR'),
          signup_date: byFieldRule(patients, 'signup_date', 'DATE_ORDER_FROM_SEPARATOR'),
          submitted_at: byFieldRule(intakes, 'submitted_at', 'DATE_ORDER_FROM_SEPARATOR'),
        },
      },
    ),
    vocabulary(
      'Confirm that outcome `OK` means approved',
      'outcome',
      'OUTCOME_OK_ASSUMED_APPROVED',
      {
        evidence: RULE_CODES.OUTCOME_OK_ASSUMED_APPROVED,
        rows: idsWithRule(intakes, 'OUTCOME_OK_ASSUMED_APPROVED', (i) => i.intakeId),
      },
    ),
    vocabulary(
      'Confirm that questionnaire label `2.0` is v2',
      'questionnaire_version',
      'VERSION_LABEL_ASSUMED_V2',
      {
        evidence: RULE_CODES.VERSION_LABEL_ASSUMED_V2,
        rows: idsWithRule(intakes, 'VERSION_LABEL_ASSUMED_V2', (i) => i.intakeId),
      },
    ),
    vocabulary('bsn retention: keep, mask or drop', 'bsn', 'BSN_RETENTION', {
      rows_with_bsn: patients.filter((p) => p.canonical.bsn !== null).length,
      elfproef_failures: patients.filter((p) => p.canonical.bsnCheck === 'invalid').length,
      note: 'The console masks bsn by default until this is answered (findings, bsn).',
    }),
  ];
}

// ---------------------------------------------------------------------------------------------
// Bookkeeping items of ADR-0004
// ---------------------------------------------------------------------------------------------

/**
 * All but the last three characters, for an identifier that must not be readable in a payload.
 * `review_items.payload` is jsonb, so the console's column-level masking cannot reach into it,
 * and bsn retention is still an open vocabulary item ("bsn retention: keep, mask or drop").
 */
function mask(value: string): string {
  if (value.length <= 3) return '*'.repeat(value.length);
  return '*'.repeat(value.length - 3) + value.slice(-3);
}

const MASKED_SOURCE_COLUMNS = new Set(['bsn']);

/** The source columns whose values differ, stored beside incoming, identifiers masked. */
function sourceDifferences(
  storedFields: Readonly<Record<string, string>>,
  incomingFields: Readonly<Record<string, string>>,
): Record<string, { stored: string; incoming: string }> {
  const out: Record<string, { stored: string; incoming: string }> = {};
  for (const [field, stored] of Object.entries(storedFields)) {
    const incoming = incomingFields[field] ?? '';
    if (incoming === stored) continue;
    out[field] = MASKED_SOURCE_COLUMNS.has(field)
      ? { stored: mask(stored), incoming: mask(incoming) }
      : { stored, incoming };
  }
  return out;
}

export function changedSourceRowItems(
  changed: readonly ChangedRawRow[],
  ids: Ids,
): ReviewItemDraft[] {
  return changed.map((c) =>
    rowItem({
      type: 'data_quality',
      title: `source row changed since import run ${c.stored.importRunId}`,
      reason:
        'the export contains a different version of a row already stored; the stored row is kept',
      // The differing columns only: the whole row would carry bsn, phone, dob and email of a
      // patient whose record did not change in those columns into the review queue.
      payload: {
        table: c.table,
        key: c.key,
        stored_import_run_id: c.stored.importRunId,
        stored_row_hash: c.stored.rowHash,
        incoming_row_hash: c.incoming.rowHash,
        incoming_line_no: c.incoming.lineNo,
        differences: sourceDifferences(c.storedFields, c.incomingFields),
      },
      patientId: c.table === 'legacy_patients_raw' ? (ids.patients.get(c.key) ?? null) : null,
      intakeId: c.table === 'legacy_intakes_raw' ? (ids.intakes.get(c.key) ?? null) : null,
      field: null,
      dedupeKey: dedupeKey([
        'data_quality',
        'row',
        `${c.table}:${c.key}`,
        null,
        'SOURCE_ROW_CHANGED',
        c.incoming.rowHash,
      ]),
    }),
  );
}

/**
 * ADR-0009 item 9: a natural key the export repeats with different values. One row is stored and
 * the later one is not, so this item is the only place that row survives — which is why the
 * payload carries it whole, as exported, identifiers included.
 */
export function repeatedKeyItems(repeats: readonly RepeatedRawRow[], ids: Ids): ReviewItemDraft[] {
  return repeats
    .filter((r) => !r.identical)
    .map((r) => {
      const patient = r.table === 'legacy_patients_raw';
      const entityType = patient ? 'legacy_patient' : 'legacy_intake';
      const label = patient ? 'legacy id' : 'intake id';
      return rowItem({
        type: 'data_quality',
        title: `${label} repeated in the export with different values`,
        reason:
          `line ${r.storedLineNo} is stored and line ${r.lineNo} is not; keep the stored values ` +
          'or replace individual fields through the resolution path',
        payload: {
          table: r.table,
          key: r.key,
          stored_line_no: r.storedLineNo,
          repeated_line_no: r.lineNo,
          repeated_row_hash: r.rowHash,
          differences: sourceDifferences(r.storedFields, r.fields),
          // Unmasked and complete: the raw table is keyed by this natural key, so the repeated
          // row is stored nowhere else and a redacted copy would lose it (ADR-0009 item 9).
          repeated_row: r.fields,
        },
        patientId: patient ? (ids.patients.get(r.key) ?? null) : null,
        intakeId: patient ? null : (ids.intakes.get(r.key) ?? null),
        field: null,
        dedupeKey: dedupeKey([
          'data_quality',
          'row',
          `${entityType}:${r.key}`,
          null,
          'SOURCE_KEY_REPEATED',
          r.rowHash,
        ]),
      });
    });
}

export function humanOwnedConflictItems(
  conflicts: readonly HumanOwnedConflict[],
): ReviewItemDraft[] {
  return conflicts.map((c) =>
    rowItem({
      type: 'data_quality',
      title: `${c.field} was set by a human and the export now maps differently`,
      reason: `human decision in audit entry ${c.auditEntryId} is kept; the importer did not write`,
      payload: {
        entity_type: c.entityType,
        entity_id: c.entityId,
        natural_key: c.naturalKey,
        field: c.field,
        stored: c.stored,
        mapped: c.mapped,
        audit_entry_id: c.auditEntryId,
      },
      patientId: c.entityType === 'patient' ? c.entityId : null,
      intakeId: c.entityType === 'intake' ? c.entityId : null,
      field: c.field,
      dedupeKey: dedupeKey([
        'data_quality',
        'row',
        `${c.entityType}:${c.naturalKey}`,
        c.field,
        'HUMAN_OWNED_FIELD_DIFFERS',
        c.mapped === null ? null : JSON.stringify(c.mapped),
      ]),
    }),
  );
}
