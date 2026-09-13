import type { ReactElement, ReactNode } from 'react';

/** One self-contained block of the page: a step of the form, a panel of the console. */
export function Card({ title, children }: { title?: string; children: ReactNode }): ReactElement {
  return (
    <section className="rounded-xl border border-grey-200 bg-white p-6 shadow-xs">
      {title !== undefined && (
        <h2 className="mb-5 text-lg font-semibold tracking-tight text-grey-900">{title}</h2>
      )}
      {children}
    </section>
  );
}
