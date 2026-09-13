import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';

/** One labelled row of choices — the queue's types, its states, its age, its status. */
export function FilterGroup({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-2 last:mb-0">
      <span className="w-16 shrink-0 text-sm font-medium text-grey-500">{label}</span>
      {children}
    </div>
  );
}

/**
 * One choice, as a link rather than a control: the queue's filters are the URL, so a reviewer can
 * keep a filtered queue open in a tab, and the page needs no client state to show it.
 */
export function FilterLink({
  href,
  selected = false,
  count,
  children,
}: {
  readonly href: string;
  readonly selected?: boolean;
  /** Shown beside the label, so how much of each kind there is needs no click (R-C3). */
  readonly count?: number;
  readonly children: ReactNode;
}): ReactElement {
  const tone = selected
    ? 'border-accent-600 bg-accent-50 text-accent-700'
    : 'border-grey-300 bg-white text-grey-700 hover:bg-grey-100';
  return (
    <Link
      href={href}
      aria-current={selected ? 'true' : undefined}
      className={`inline-flex items-baseline gap-1.5 rounded-full border px-3 py-1 text-sm ${tone}`}
    >
      {children}
      {count !== undefined && <span className="tabular-nums text-grey-500">{count}</span>}
    </Link>
  );
}

/** The filters as a whole, above the list they narrow. */
export function FilterPanel({ children }: { readonly children: ReactNode }): ReactElement {
  return <div className="mb-6 rounded-lg border border-grey-200 bg-grey-50 p-4">{children}</div>;
}
