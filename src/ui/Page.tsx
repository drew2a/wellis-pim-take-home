import type { ReactElement, ReactNode } from 'react';

/** The frame every screen sits in: the product name, one column, room to breathe. */
export function Page({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="min-h-screen">
      <header className="border-b border-grey-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-baseline gap-2 px-5 py-3">
          <span className="font-semibold tracking-tight text-accent-700">Wellis</span>
          <span className="text-sm text-grey-500">Intake</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 pt-8 pb-20">{children}</main>
    </div>
  );
}

export function PageTitle({ children }: { children: ReactNode }): ReactElement {
  return <h1 className="mb-2 text-2xl font-semibold tracking-tight text-grey-900">{children}</h1>;
}
