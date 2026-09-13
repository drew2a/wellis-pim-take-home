import type { ReactElement, ReactNode } from 'react';

export interface Definition {
  /**
   * React's key for this row, where the list has a real identity to give — a review item's id.
   * Terms repeat and are sometimes empty, so they cannot serve: a list keyed by term rendered one
   * row for every group of entries sharing a day, and none of the rest.
   */
  readonly key?: string;
  readonly term: string;
  readonly value: ReactNode;
}

/**
 * Facts about one thing: the evidence under a rule, the fields of a record. A description list
 * rather than a table, because these are labelled values and not rows of the same shape.
 */
export function Definitions({ items }: { readonly items: readonly Definition[] }): ReactElement {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-grey-800">
      {items.map((item, index) => (
        <div key={item.key ?? index} className="contents">
          <dt className="text-sm text-grey-500">{item.term}</dt>
          <dd className="min-w-0 break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A value the product did not author — a raw cell, a matched term — set apart from our own text. */
export function Raw({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <code className="rounded bg-grey-100 px-1.5 py-0.5 font-mono text-sm text-grey-800">
      {children}
    </code>
  );
}
