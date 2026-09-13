// Where the open row sits in the queue behind it, and what ↑ and ↓ point at (ADR-0028).
//
// Separate from `ConsoleShell` because it is the only part of the shell that can be wrong in a way
// a reviewer would notice — the wrong row marked, ↓ skipping one, ↑ at the top going somewhere —
// and the rest of the shell is a database read that cannot be tested without one.
import type { QueueKind, QueueRow } from '@/repo/queue';

export interface QueuePlace {
  /**
   * "3 of 13", or null when the open row is not in this list at all — a resolved item reached from
   * a link, an intake opened from a patient's record. ↑ and ↓ then point nowhere rather than
   * somewhere arbitrary.
   */
  readonly position: string | null;
  readonly prevHref: string | null;
  readonly nextHref: string | null;
}

/** Which row the detail pane is showing. */
export interface Selection {
  readonly kind: QueueKind;
  readonly id: string;
}

/**
 * A row's URL, carrying the queue it was opened from: the three panes agree about what the list is
 * only if opening a row keeps the filters that produced it.
 */
export const hrefOf = (row: Selection, query: string): string =>
  `/console/${row.kind === 'intake' ? 'intakes' : 'items'}/${row.id}${query}`;

export function placeIn(
  rows: readonly QueueRow[],
  selected: Selection | null,
  query: string,
): QueuePlace {
  const at =
    selected === null
      ? -1
      : rows.findIndex((row) => row.kind === selected.kind && row.id === selected.id);
  if (at === -1) return { position: null, prevHref: null, nextHref: null };

  const href = (index: number): string | null => {
    const row = rows[index];
    return row === undefined ? null : hrefOf(row, query);
  };
  return {
    position: `${at + 1} of ${rows.length}`,
    prevHref: at === 0 ? null : href(at - 1),
    nextHref: href(at + 1),
  };
}
