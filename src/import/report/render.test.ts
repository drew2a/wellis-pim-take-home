// The Markdown is a pure function of the JSON (ADR-0011 item 14): given the same report it
// renders the same bytes, it reads nothing but the report, and no number appears in it that is
// not in the JSON — otherwise the two committed files could disagree about the same export.
import { describe, expect, it } from 'vitest';

import { renderJson } from './files';
import { renderMarkdown } from './render';
import type { ImportReport } from './types';

const report: ImportReport = {
  asOf: '2026-09-08',
  importerVersion: '1.0.0',
  rulesetVersion: 'v1',
  whatCameIn: {
    files: [{ name: 'patients.csv', bytes: 12, sha256: 'abc' }],
    rawRows: [{ key: 'legacy_patients_raw', rows: 7 }],
    repeatedKeys: 0,
    changedSinceEarlierRun: 0,
    patients: { legacyRows: 7, surviving: 6, mergedAway: 1, legacyIdsResolving: 7 },
    intakes: { rows: 9, orphans: 2 },
    consentEvents: { rows: 4, withoutPatient: 0 },
  },
  whatWasCleaned: {
    records: 5,
    byRule: [
      {
        rule: 'WHITESPACE_TRIM',
        rows: 5,
        blanked: 0,
        fields: [{ key: 'full_name', rows: 5 }],
        evidence: { profile: ['P-2'] },
      },
    ],
    daylightSaving: { ambiguous: 0, nonexistent: 0 },
  },
  whatWasQuarantined: {
    items: 3,
    byStatus: [{ key: 'open', rows: 3 }],
    byTypeAndScope: [{ type: 'data_quality', scope: 'row', items: 3 }],
    byRule: [{ type: 'data_quality', scope: 'row', rule: 'BSN_INVALID', items: 3 }],
  },
  rulesApplied: [
    {
      statement: 'The outcome spelling `OK` means approved',
      rule: 'OUTCOME_OK_ASSUMED_APPROVED',
      rows: 441,
      evidence: { profile: 'P-25' },
    },
    { statement: 'An intake weight is in kilograms', rule: null, rows: null, evidence: {} },
  ],
  identity: {
    candidates: 4,
    tier1Merged: 1,
    tier2: 1,
    tier3: 2,
    tier1HumanDecided: 0,
    survivorRule: [{ key: 'survivor signed up later', rows: 1 }],
    fieldsGainedFromLosers: 0,
  },
  consent: {
    statesPerPatient: [{ key: 'granted', rows: 6 }],
    statesPerLegacyRow: [
      { key: 'granted', rows: 6 },
      { key: 'no_record', rows: 1 },
    ],
    statesOfMergedAwayRows: [{ key: 'no_record', rows: 1 }],
    statesChangedByMerge: [{ key: 'no_record -> granted', rows: 1 }],
    itemsPerPatient: [{ key: 'CONSENT_CONFLICT', rows: 1 }],
    itemsPerLegacyRow: [{ key: 'CONSENT_CONFLICT', rows: 1 }],
    timing: {
      intakesBeforeFirstGrant: 71,
      patientsWithAnIntakeBeforeFirstGrant: 70,
      intakesAfterRevocationWithNoLaterGrant: 83,
    },
    futureDatedEvents: [{ key: 'revoked', rows: 66 }],
  },
  shadowEvaluation: {
    evaluations: 9,
    matrix: [
      { engineOutcome: 'auto_cleared', legacyOutcome: 'approved', intakes: 5 },
      { engineOutcome: 'auto_cleared', legacyOutcome: 'rejected', intakes: 2 },
      { engineOutcome: 'auto_rejected', legacyOutcome: 'approved', intakes: 1 },
      { engineOutcome: 'not_evaluable', legacyOutcome: 'pending', intakes: 1 },
    ],
    hardDisagreements: { autoRejectedWhereLegacyApproved: 1, autoClearedWhereLegacyRejected: 2 },
    notEvaluable: 1,
    ruleHits: [{ key: 'bmi_below_minimum', rows: 191 }],
    itemsRaised: [{ rule: 'HISTORY_GLP1_MEDICATION', legacyOutcome: 'approved', intakes: 28 }],
    unreadableOutcomeCarveOut: { unreadableOutcomes: 9, minorsAmongThem: 0 },
  },
  notInExportNotes: [
    {
      finding: '`source` carries a sixth funnel',
      numbers: { patients: 389 },
      evidence: 'P-14',
      notCovered: 'the notes list four and stop there',
    },
  ],
};

describe('renderMarkdown', () => {
  const markdown = renderMarkdown(report);

  it('is deterministic: the same report renders the same bytes', () => {
    expect(renderMarkdown(report)).toBe(markdown);
    expect(renderMarkdown(structuredClone(report))).toBe(markdown);
  });

  it('renders every section of the report', () => {
    for (const heading of [
      '# Import report',
      '## What came in',
      '## What was cleaned',
      '## What was quarantined',
      '## Rules applied, and the assumptions under them',
      '## Identity: duplicate patient records',
      '## Consent',
      '## The ruleset against history (shadow evaluation)',
      '## Not in EXPORT-NOTES.md',
    ]) {
      expect(markdown).toContain(heading);
    }
  });

  it('carries no run id and no clock, only the inputs the numbers depend on', () => {
    expect(markdown).toContain('`2026-09-08`');
    expect(markdown).toContain('`1.0.0`');
    expect(markdown).toContain('`v1`');
    expect(markdown).not.toMatch(/import run \d|\d{4}-\d\d-\d\dT\d\d:/u);
  });

  it('renders the matrix as a matrix, with a zero where no intake falls', () => {
    expect(markdown).toContain(
      '| engine outcome \\ legacy outcome | approved | pending | rejected |',
    );
    expect(markdown).toContain('| `auto_cleared` | 5 | 0 | 2 |');
    expect(markdown).toContain('| `not_evaluable` | 0 | 1 | 0 |');
  });

  it('states both hard-disagreement cells and neither of the other two outcomes', () => {
    expect(markdown).toContain('`auto_rejected` where the legacy outcome was approved (1)');
    expect(markdown).toContain('`auto_cleared` where it was rejected (2)');
    expect(markdown).toContain('`auto_flagged` is never one');
  });

  it('changes when a number in the JSON changes', () => {
    const changed = structuredClone(report) as {
      whatCameIn: { intakes: { orphans: number } };
    } & ImportReport;
    changed.whatCameIn.intakes.orphans = 3;
    expect(renderMarkdown(changed)).not.toBe(markdown);
  });

  it('ends in exactly one newline, so a diff of the file has no trailing noise', () => {
    expect(markdown.endsWith('\n')).toBe(true);
    expect(markdown.endsWith('\n\n')).toBe(false);
    expect(renderJson(report).endsWith('}\n')).toBe(true);
  });
});
