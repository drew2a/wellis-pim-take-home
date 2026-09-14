// Pure tests over the whole export: the review layer produces exactly the items the findings
// predict (findings: email, dob, bsn, signup_date, legacy_patient_id; ADR-0006 orphans).
import { describe, expect, it } from 'vitest';

import { loadRules } from '@/rules/load';

import { mapConsentEvent } from '../mapper/consent-event';
import { mapIntake } from '../mapper/intake';
import { mapPatient } from '../mapper/patient';
import { parseCsv } from '../source/csv';
import { readExportFiles } from '../source/files';
import { parseConsentsJsonl } from '../source/jsonl';
import { INTAKES_HEADER, PATIENTS_HEADER, byHeader } from '../source/layout';
import { dobFlipItems, orphanItems, shiftedPatientItems, shiftedPatients } from './cross-file';
import { dedupeKey, dedupeParts, ruleOf } from './items';
import {
  confirmationItems,
  consentFlagItems,
  intakeFlagItems,
  patientFlagItems,
  unseenValueItems,
  type Ids,
} from './mapping-items';

const rules = loadRules();
const context = { asOf: '2026-09-08', rules };
const files = readExportFiles('legacy_export');
const data = {
  patients: parseCsv(files['patients.csv'].bytes, PATIENTS_HEADER).map((r) =>
    mapPatient(byHeader(PATIENTS_HEADER, r.fields), context),
  ),
  intakes: parseCsv(files['intakes.csv'].bytes, INTAKES_HEADER).map((r) =>
    mapIntake(byHeader(INTAKES_HEADER, r.fields), context),
  ),
  consents: parseConsentsJsonl(files['consents.jsonl'].bytes).map((r) =>
    mapConsentEvent(r.lineNo, r.fields),
  ),
};
// Natural keys stand in for uuids: the item builders only look them up.
const ids: Ids = {
  patients: new Map(data.patients.map((p) => [p.legacyId, `uuid-${p.legacyId}`])),
  intakes: new Map(data.intakes.map((i) => [i.intakeId, `uuid-${i.intakeId}`])),
};
const legacyIds = new Set(data.patients.map((p) => p.legacyId));
const orphans = data.intakes.filter((i) => !legacyIds.has(i.legacyPatientId));

const countBy = <T>(items: readonly T[], key: (item: T) => string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
};

describe('dedupeKey', () => {
  it('is stable and escapes the separator inside values', () => {
    expect(dedupeKey(['a', null, 'b'])).toBe('a||b');
    expect(dedupeKey(['x|y', 'z'])).toBe('x\\|y|z');
    expect(dedupeKey(['x|y', 'z'])).not.toBe(dedupeKey(['x', 'y|z']));
  });

  // The import report groups stored items by rule, which lives nowhere but the key.
  it('round-trips through dedupeParts, escaping included', () => {
    const parts = ['data_quality', 'row', 'legacy_patient:rec|1', 'we\\ight', 'RULE', ''];
    expect(dedupeParts(dedupeKey(parts))).toEqual(parts);
    expect(dedupeParts(dedupeKey(['a', null, 'b']))).toEqual(['a', '', 'b']);
  });

  it('reads the rule out of a key and refuses one that names none', () => {
    expect(
      ruleOf(dedupeKey(['consent', 'row', 'legacy_patient:rec1', 'x', 'CONSENT_CONFLICT', 'y'])),
    ).toBe('CONSENT_CONFLICT');
    expect(() => ruleOf(dedupeKey(['a', 'b', 'c', 'd', null, 'f']))).toThrow(/names no rule/u);
    expect(() => ruleOf('a|b|c')).toThrow(/names no rule/u);
  });
});

describe('row items from patient flags', () => {
  const items = data.patients.flatMap((p) => patientFlagItems(p, ids));

  it('raises exactly the findings counts and links each to its patient', () => {
    expect(countBy(items, (i) => `${i.field}:${i.title}`)).toEqual({
      'email:email missing, placeholder typed': 11,
      'email:email contains a space': 10,
      'dob:date of birth is impossible': 5,
      'bsn:bsn fails the elfproef': 17,
    });
    expect(items.every((i) => i.patientId?.startsWith('uuid-rec'))).toBe(true);
    expect(new Set(items.map((i) => i.dedupeKey)).size).toBe(items.length);
  });

  // bsn is the one identifier in this set. review_items.payload is jsonb, which the console's
  // column-level masking cannot reach into, and dedupe_key is the idempotency key (R-A15): a
  // later "bsn retention: drop" must not have to rewrite keys and re-open every resolved item.
  it('masks the bsn in the payload and digests it in the dedupe key', () => {
    const bsnItems = items.filter((i) => i.field === 'bsn');
    const raws = data.patients.flatMap((p) =>
      p.flags
        .filter((f) => f.kind === 'bsn_invalid' || f.kind === 'bsn_malformed')
        .map((f) => f.raw),
    );
    expect(bsnItems).toHaveLength(17);
    expect(raws).toHaveLength(17);
    for (const item of bsnItems) {
      expect((item.payload as { raw_masked: string }).raw_masked).toMatch(/^\*{6}\d{3}$/);
      expect(item.dedupeKey).toMatch(/\|sha256:[0-9a-f]{64}$/);
    }
    const serialised = JSON.stringify(bsnItems);
    for (const raw of raws) expect(serialised).not.toContain(raw);
  });

  it('carries the proposal only on the internal-space items', () => {
    const withProposal = items.filter((i) => i.proposedResolution !== null);
    expect(withProposal).toHaveLength(10);
    expect(withProposal.every((i) => i.proposedResolution?.field === 'email')).toBe(true);
    expect(withProposal.map((i) => i.proposedResolution?.proposed_value)).toContain(
      'willem.ricci@icloud.com',
    );
  });
});

describe('cross-file items', () => {
  it('flags the 6 patients whose alternative dob reading flips minor/adult at an intake', () => {
    const items = dobFlipItems(data, ids, rules);
    expect(items).toHaveLength(6);
    for (const item of items) {
      const payload = item.payload as {
        intakes: { age_under_convention: number; age_under_alternative: number }[];
      };
      expect(payload.intakes.length).toBeGreaterThan(0);
      for (const flip of payload.intakes) {
        expect(flip.age_under_convention < 18).not.toBe(flip.age_under_alternative < 18);
      }
    }
  });

  it('raises one item per patient in 2062 listing every date of theirs', () => {
    expect(shiftedPatients(data.patients).size).toBe(3);
    const items = shiftedPatientItems(data, ids);
    expect(items).toHaveLength(3);
    const total = items.reduce((n, i) => {
      const p = i.payload as { intakes: unknown[]; consent_events: unknown[] };
      return n + p.intakes.length;
    }, 0);
    // findings, submitted_at: the 3 rows in 2062 belong to these patients.
    expect(total).toBe(3);
    expect(
      items.every((i) => (i.payload as { consent_events: unknown[] }).consent_events.length === 1),
    ).toBe(true);
  });

  it('folds an intake in 2062 into its patient item instead of raising its own', () => {
    const shifted = shiftedPatients(data.patients);
    const items = data.intakes.flatMap((i) =>
      intakeFlagItems(i, ids, shifted.has(i.legacyPatientId)),
    );
    expect(items).toEqual([]);
  });

  it('raises one orphan item per orphan, with the two ADR-0006 actions', () => {
    const items = orphanItems(orphans, ids);
    expect(items).toHaveLength(21);
    expect(items.every((i) => i.patientId === null && i.intakeId?.startsWith('uuid-INT'))).toBe(
      true,
    );
    expect((items[0]?.payload as { actions: string[] }).actions).toEqual([
      'attach_to_existing_patient',
      'leave_unresolved',
    ]);
  });

  // ADR-0029: body measurements are not a weaker identity signal, they are not one, so the item
  // offers no candidate patients at all.
  it('offers no candidate patients on any orphan item', () => {
    const keys = new Set(orphanItems(orphans, ids).flatMap((i) => Object.keys(i.payload)));
    expect([...keys].sort()).toEqual(['actions', 'intake', 'intake_id', 'legacy_patient_id']);
  });
});

describe('vocabulary items', () => {
  it('raises n.v.t. once, and no unseen closed-vocabulary value in this export', () => {
    const items = unseenValueItems(data.patients, data.intakes, data.consents);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'vocabulary',
      scope: 'vocabulary',
      field: 'alcohol_units_week',
      title: 'alcohol_units_week: `n.v.t.` on 272 rows is not a number: zero or not answered?',
    });
    expect((items[0]?.payload as { rows: string[] }).rows).toHaveLength(272);
  });

  it('raises the four confirmation items with the rows they cover', () => {
    const items = confirmationItems(data.patients, data.intakes);
    expect(items.map((i) => [i.field, i.title])).toEqual([
      [null, 'Confirm the date separator convention (dash = D-M-Y, slash = M-D-Y)'],
      ['outcome', 'Confirm that outcome `OK` means approved'],
      ['questionnaire_version', 'Confirm that questionnaire label `2.0` is v2'],
      ['bsn', 'bsn retention: keep, mask or drop'],
    ]);
    expect((items[0]?.payload as { rows_converted: unknown }).rows_converted).toEqual({
      dob: 638,
      signup_date: 647,
      submitted_at: 413,
    });
    expect((items[1]?.payload as { rows: string[] }).rows).toHaveLength(441);
    expect((items[2]?.payload as { rows: string[] }).rows).toHaveLength(394);
    expect((items[3]?.payload as { rows_with_bsn: number }).rows_with_bsn).toBe(941);
  });

  it('raises nothing from consent events in this export', () => {
    expect(data.consents.flatMap((c) => consentFlagItems(c, ids))).toEqual([]);
  });
});
