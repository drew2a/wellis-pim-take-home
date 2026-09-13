// One row of "how this record came to look the way it does". It is its own module because the
// rule below — which facts a row prints, and how many times — is worth a test, and a test cannot
// reach into an async server component.
import Link from 'next/link';
import type { ReactNode } from 'react';

import type { TimelineEntry } from '@/repo/patient-detail';
import { Raw } from '@/ui';

function changeLine(change: {
  field: string;
  from: string | null;
  to: string | null;
  chosen?: string;
  source_legacy_id?: string;
}): string {
  const provenance = [
    change.chosen === undefined ? '' : `chosen: ${change.chosen}`,
    change.source_legacy_id === undefined ? '' : `from ${change.source_legacy_id}`,
  ]
    .filter((part) => part !== '')
    .join(', ');
  const arrow = `${change.field}: ${change.from ?? '—'} → ${change.to ?? '—'}`;
  return provenance === '' ? arrow : `${arrow} (${provenance})`;
}

/**
 * Every fact the entry carries, each of them once.
 *
 * A normalisation record's reason *is* its change — the repository writes it as `field: from → to`
 * — so its changes list would print the same arrow a second time; the row shows the change and
 * then the rule code that made it. A transition's reason is a sentence about the move, and its
 * changes say which fields moved, so both are shown: there is nothing repeated to drop.
 */
export function entryValue(entry: TimelineEntry): ReactNode {
  const states =
    entry.fromState === null && entry.toState === null
      ? null
      : `${entry.fromState ?? '—'} → ${entry.toState ?? '—'}`;
  const changes = entry.kind === 'normalisation' ? [] : (entry.changes ?? []);
  return (
    <span>
      {states !== null && <Raw>{states}</Raw>} {entry.reason}
      {entry.rule !== null && (
        <>
          {' '}
          <Raw>{entry.rule}</Raw>
        </>
      )}
      {changes.map((change, index) => (
        <span key={index}>
          {' · '}
          <Raw>{changeLine(change)}</Raw>
        </span>
      ))}
      {entry.reviewItem !== null && (
        <>
          {' · '}
          <Link href={`/console/items/${entry.reviewItem.id}`}>{entry.reviewItem.title}</Link>
        </>
      )}
    </span>
  );
}
