// A timeline row prints each fact once. The bug this pins: a normalisation record's reason already
// reads `field: from → to`, and the row printed that arrow again from the entry's changes list.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { TimelineEntry } from '@/repo/patient-detail';

import { entryValue } from './entry';

const AT = new Date('2026-09-14T10:00:00.000Z');

const entry = (given: Partial<TimelineEntry>): TimelineEntry => ({
  kind: 'audit',
  at: AT,
  seq: 1,
  actor: 'importer 1.0.0',
  entity: 'patient p-1',
  fromState: null,
  toState: null,
  reason: '',
  changes: null,
  reviewItem: null,
  rule: null,
  evidence: null,
  ...given,
});

const render = (given: TimelineEntry): string => renderToStaticMarkup(entryValue(given));

/** The rendered row as a reader sees it: text, without the markup around it. */
const rowText = (given: TimelineEntry): string => render(given).replace(/<[^>]*>/g, '');

const occurrences = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe('one row of the timeline', () => {
  const CHANGE = 'signup_date: 07-04-2022 → 2022-04-07';

  it('prints a normalisation change once, then the rule that made it', () => {
    const row = rowText(
      entry({
        kind: 'normalisation',
        reason: CHANGE,
        rule: 'DATE_ORDER_FROM_SEPARATOR',
        changes: [{ field: 'signup_date', from: '07-04-2022', to: '2022-04-07' }],
      }),
    );

    expect(occurrences(row, CHANGE)).toBe(1);
    // The change leads and the code follows it — the reviewer reads one and cites the other.
    expect(row.indexOf('DATE_ORDER_FROM_SEPARATOR')).toBeGreaterThan(row.indexOf(CHANGE));
  });

  // The code is the row's link to the "rules applied" table of the import report and the evidence
  // that the change names its rule, so it is kept on the row — but set as a caption beside the
  // sentence, not as one more chip competing with the raw values. Which grey is `src/ui`'s to say;
  // what this pins is that the code is not promoted back to a `Raw` chip.
  it('carries the rule code beside the change, not as a chip of its own', () => {
    const row = render(
      entry({
        kind: 'normalisation',
        reason: 'sex: F → female',
        rule: 'VOCAB_SEX',
        changes: [{ field: 'sex', from: 'F', to: 'female' }],
      }),
    );

    expect(row).toContain('VOCAB_SEX');
    expect(row).not.toMatch(/<code[^>]*>[^<]*VOCAB_SEX/);
  });

  // A transition's reason is a sentence, not an arrow, so its changes are the only place the
  // fields it moved are named: dropping them there would lose the fact, not de-duplicate it.
  it('prints a transition change once, alongside the sentence that explains it', () => {
    const row = rowText(
      entry({
        fromState: 'needs_review',
        toState: 'approved',
        reason: 'the reviewer accepted the corrected date',
        changes: [{ field: 'signup_date', from: '07-04-2022', to: '2022-04-07' }],
      }),
    );

    expect(occurrences(row, CHANGE)).toBe(1);
    expect(row).toContain('the reviewer accepted the corrected date');
    expect(row).toContain('needs_review → approved');
  });
});
