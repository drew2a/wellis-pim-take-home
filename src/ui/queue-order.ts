// How the queue's rows are ordered, on the client side of the one toggle that reorders them.
//
// The order itself is the query's (`@/repo/queue`): the intakes waiting for a person, then the
// review items, each group oldest first. This module is only what the "newest first" button does
// to the page already rendered — and the point of it is that the button flips the *age*, not the
// groups: people waiting come before data to clean either way (`docs/reviewer-day.md`).
//
// The `QueueKind` is the query's own, imported as a type and so erased at compile
// (`verbatimModuleSyntax`): naming the two sources of work twice is how the two halves of one
// order drift apart.
import type { QueueKind } from '@/repo/queue';

/**
 * The rows as the reviewer reads them: the server's order, or the age reversed inside each group.
 *
 * A group is a run of rows the server put together, not a rule this module repeats. Reversing runs
 * rather than partitioning by `kind` means the toggle cannot change the grouping it is given —
 * including when it is given none — so the one thing it does is the one thing it says it does.
 */
export function ordered<T extends { readonly kind: QueueKind }>(
  rows: readonly T[],
  newestFirst: boolean,
): readonly T[] {
  if (!newestFirst) return rows;
  const flipped: T[] = [];
  let run: T[] = [];
  for (const row of rows) {
    const previous = run[run.length - 1];
    if (previous !== undefined && previous.kind !== row.kind) {
      flipped.push(...run.reverse());
      run = [];
    }
    run.push(row);
  }
  flipped.push(...run.reverse());
  return flipped;
}
