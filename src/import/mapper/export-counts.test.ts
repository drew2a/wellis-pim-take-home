// The acceptance criterion carried forward from the ADR-0005 review (AGENT-NOTES.md): the
// mapper reproduces the mapping-table counts for this export. Pure: reads the files, no database.
import { describe, expect, it } from 'vitest';

import { loadRules } from '@/rules/load';

import { parseCsv } from '../source/csv';
import { readExportFiles } from '../source/files';
import { parseConsentsJsonl } from '../source/jsonl';
import { INTAKES_HEADER, PATIENTS_HEADER, byHeader } from '../source/layout';
import { mapConsentEvent } from './consent-event';
import { mapIntake } from './intake';
import { mapPatient } from './patient';
import type { Flag, RecordDraft } from './types';

const context = { asOf: '2026-09-08', rules: loadRules() };
const files = readExportFiles('legacy_export');
const patients = parseCsv(files['patients.csv'].bytes, PATIENTS_HEADER).map((r) =>
  mapPatient(byHeader(PATIENTS_HEADER, r.fields), context),
);
const intakes = parseCsv(files['intakes.csv'].bytes, INTAKES_HEADER).map((r) =>
  mapIntake(byHeader(INTAKES_HEADER, r.fields), context),
);
const consents = parseConsentsJsonl(files['consents.jsonl'].bytes).map((r) =>
  mapConsentEvent(r.lineNo, r.fields),
);

function countBy(records: readonly RecordDraft[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of records) {
    const key = `${r.field}:${r.ruleCode}`;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function countFlags(flags: readonly Flag[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of flags) {
    const key = `${f.field}:${f.kind}`;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

describe('normalisation records over the whole export equal the ADR-0005 table', () => {
  it('patients.csv', () => {
    expect(countBy(patients.flatMap((p) => p.records))).toEqual({
      'full_name:WHITESPACE_TRIM': 72,
      'email:WHITESPACE_TRIM': 30,
      'email:EMAIL_LOWERCASE': 28,
      'email:EMAIL_PLACEHOLDER_TO_NULL': 11,
      'email:EMAIL_INTERNAL_SPACE_TO_NULL': 10,
      'dob:DATE_ORDER_FROM_SEPARATOR': 638,
      // ADR-0005 says 6 (5 future, 1 above 100). The one above 100 is recuSs76Rr161XtAA, born
      // 1958 with a signup date in 2062: the signup is what is impossible, and it has its own
      // item, so the dob is kept. 5 is the right count; the ADR figure double-counts that row.
      'dob:DATE_IMPOSSIBLE_TO_NULL': 5,
      'sex:VOCAB_SEX': 1976,
      'phone:PHONE_E164_NL_MOBILE': 1259,
      'weight_kg:WEIGHT_LBS_TO_KG': 55,
      'weight_kg:WEIGHT_UNIT_MISSING_TO_NULL': 18,
      'weight_kg:IMPLAUSIBLE_TO_NULL': 5,
      'height_cm:IMPLAUSIBLE_TO_NULL': 5,
      'status:VOCAB_STATUS': 1917,
      'signup_date:DATE_ORDER_FROM_SEPARATOR': 647,
      'signup_date:DATE_IMPOSSIBLE_TO_NULL': 3,
    });
  });

  it('intakes.csv', () => {
    expect(countBy(intakes.flatMap((i) => i.records))).toEqual({
      'submitted_at:DATE_ORDER_FROM_SEPARATOR': 413,
      'submitted_at:DATE_IMPOSSIBLE_TO_NULL': 3,
      'questionnaire_version:VERSION_LABEL_ASSUMED_V2': 394,
      'weight_kg:IMPLAUSIBLE_TO_NULL': 6,
      'height_cm:IMPLAUSIBLE_TO_NULL': 6,
      'medication_report:VOCAB_NONE_MEDICATION': 815,
      'condition_report:VOCAB_NONE_CONDITION': 348,
      'alcohol_units_week:NON_NUMERIC_TO_NULL': 272,
      'outcome:VOCAB_OUTCOME': 1836,
      'outcome:OUTCOME_OK_ASSUMED_APPROVED': 441,
    });
  });

  it('consents.jsonl', () => {
    expect(countBy(consents.flatMap((c) => c.records))).toEqual({
      'at:TIMESTAMP_ZONE_ASSUMED': 2643,
    });
    expect(consents.every((c) => c.canonical !== null)).toBe(true);
    const ambiguous = consents
      .flatMap((c) => c.records)
      .filter((r) => r.detail?.ambiguous === true);
    const nonexistent = consents
      .flatMap((c) => c.records)
      .filter((r) => r.detail?.nonexistent === true);
    expect([ambiguous.length, nonexistent.length]).toEqual([0, 0]);
  });
});

describe('flags over the whole export', () => {
  it('patients.csv raises exactly the row-level facts of the findings', () => {
    expect(countFlags(patients.flatMap((p) => p.flags))).toEqual({
      'email:email_placeholder': 11,
      'email:email_internal_space': 10,
      'dob:date_impossible': 5,
      'bsn:bsn_invalid': 17,
      'weight_kg:weight_unit_missing': 18,
      'weight_kg:implausible': 5,
      'height_cm:implausible': 5,
      'signup_date:date_impossible': 3,
    });
  });

  it('intakes.csv and consents.jsonl raise no unseen vocabulary', () => {
    expect(countFlags(intakes.flatMap((i) => i.flags))).toEqual({
      'submitted_at:date_impossible': 3,
      'weight_kg:implausible': 6,
      'height_cm:implausible': 6,
      'alcohol_units_week:non_numeric': 272,
    });
    expect(consents.flatMap((c) => c.flags)).toEqual([]);
  });

  it('canonical outcomes and states match the findings', () => {
    const states: Record<string, number> = {};
    for (const i of intakes) states[i.canonical.state] = (states[i.canonical.state] ?? 0) + 1;
    expect(states).toEqual({ legacy_approved: 2068, legacy_rejected: 517, legacy_pending: 332 });
    expect(intakes.filter((i) => i.canonical.outcome === 'unknown')).toHaveLength(0);
    expect(patients.filter((p) => p.canonical.status === 'unknown')).toHaveLength(0);
    expect(patients.filter((p) => p.canonical.sex === 'unknown')).toHaveLength(0);
  });
});
