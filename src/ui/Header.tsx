import type { ReactElement, ReactNode } from 'react';

/**
 * A page's title with its actions beside it — who is signed in, the way back, the button this
 * screen is for. The console has one on every screen, so where it sits is decided once.
 */
export function PageHeader({
  title,
  children,
}: {
  readonly title: string;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-grey-200 pb-4">
      <h1 className="text-2xl font-semibold text-grey-900">{title}</h1>
      {children !== undefined && <div className="flex items-center gap-3">{children}</div>}
    </div>
  );
}

/** Small grey text beside a header — a name, a count, a caption that is not a heading. */
export function Caption({ children }: { readonly children: ReactNode }): ReactElement {
  return <span className="text-sm text-grey-500">{children}</span>;
}
