// How the queue's rows are ordered, on the client side of the one toggle that reorders them.
//
// The order itself is the query's (`@/repo/queue`): the intakes waiting for a person, then the
// review items, each group oldest first. This module is only what the "newest first" button does
// to the page already rendered — and the point of it is that the button flips the *age*, not the
// groups: people waiting come before data to clean either way (`docs/reviewer-day.md`).

/** Which of the queue's two groups a row belongs to — the same two sources as `QueueRow.kind`. */
export type QueueKind = 'intake' | 'review_item';

/**
 * The rows as the reviewer reads them: the server's order, or the age reversed inside each group.
 *
 * `newestFirst` reverses each group separately rather than the whole list, because reversing the
 * whole list would put the review items back on top — the one thing this ordering exists to
 * prevent — and would make the toggle mean two things at once.
 */
export function ordered<T extends { readonly kind: QueueKind }>(
  rows: readonly T[],
  newestFirst: boolean,
): readonly T[] {
  if (!newestFirst) return rows;
  return [
    ...rows.filter((row) => row.kind === 'intake').reverse(),
    ...rows.filter((row) => row.kind === 'review_item').reverse(),
  ];
}
