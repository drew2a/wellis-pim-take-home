import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';

import { DOT_CLASSES, type Tone } from './tones';

// The console's left pane (ADR-0028). Dark, because it is the frame around the work and not part
// of it: everything a reviewer reads is on the two light panes to its right, and the rail is where
// they are rather than what they are doing.

/** A kind's marker. `size` is the only thing that varies: 7px in the rail, 6px in the queue. */
export function Dot({
  tone,
  size = 7,
}: {
  readonly tone: Tone;
  readonly size?: 6 | 7 | 8;
}): ReactElement {
  const box = size === 6 ? 'h-1.5 w-1.5' : size === 7 ? 'h-[7px] w-[7px]' : 'h-2 w-2';
  return (
    <span
      aria-hidden="true"
      className={`block shrink-0 rounded-full ${box} ${DOT_CLASSES[tone]}`}
    />
  );
}

/** Text that is an identifier and not prose: an id, a rule code, a count, a date, a field name. */
export function Mono({ children }: { readonly children: ReactNode }): ReactElement {
  return <span className="font-mono">{children}</span>;
}

export function Rail({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <aside className="flex min-h-0 flex-col bg-rail pt-[18px] text-rail-ink">{children}</aside>
  );
}

/** The product mark: a shape, the name, and what this application is. */
export function RailBrand(): ReactElement {
  return (
    <div className="flex items-center gap-[9px] px-[18px] pb-[22px]">
      <span aria-hidden="true" className="block h-[22px] w-[22px] rounded-md bg-accent-400" />
      <span className="text-[15px] font-semibold tracking-tight text-white">Wellis</span>
      <span className="rounded border border-rail-edge px-[5px] py-[2px] font-mono text-[10px] tracking-[0.12em] text-rail-dim uppercase">
        PIM
      </span>
    </div>
  );
}

export function RailNav({ children }: { readonly children: ReactNode }): ReactElement {
  return <nav className="flex flex-col gap-0.5 px-2.5">{children}</nav>;
}

/** A place in the product, with how much is waiting there. */
export function RailNavLink({
  href,
  selected = false,
  count,
  children,
}: {
  readonly href: string;
  readonly selected?: boolean;
  readonly count: number;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <Link
      href={href}
      aria-current={selected ? 'page' : undefined}
      className={`flex items-center justify-between rounded-[7px] px-2.5 py-2 font-medium no-underline ${
        selected ? 'bg-white/9 text-white' : 'text-rail-ink hover:bg-white/5 hover:text-white'
      }`}
    >
      <span>{children}</span>
      <span className={`font-mono text-xs ${selected ? 'text-rail-bright' : 'text-rail-dim'}`}>
        {count}
      </span>
    </Link>
  );
}

/** The label over a group in the rail. Mono and spaced out: it is a divider, not a heading to read. */
export function RailLabel({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <h2 className="px-[18px] pt-[26px] pb-2 font-mono text-[10px] tracking-[0.14em] text-rail-dim uppercase">
      {children}
    </h2>
  );
}

/**
 * The kinds of open work. It scrolls: the export has seven review-item types and twelve intake
 * states, and every one of them is reachable, so the list is longer than the canvas's ten
 * (ADR-0028 §3).
 */
export function RailKinds({ children }: { readonly children: ReactNode }): ReactElement {
  return <div className="flex min-h-0 flex-col gap-px overflow-y-auto px-2.5 pb-2">{children}</div>;
}

export function RailKind({
  href,
  tone,
  count,
  selected = false,
  children,
}: {
  readonly href: string;
  readonly tone: Tone;
  readonly count: number;
  readonly selected?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <Link
      href={href}
      aria-current={selected ? 'true' : undefined}
      className={`flex items-center justify-between gap-2 rounded-[7px] px-2.5 py-[7px] text-[13px] font-medium no-underline ${
        selected ? 'bg-white/11 text-white' : 'text-rail-ink hover:bg-white/5 hover:text-white'
      }`}
    >
      <span className="flex min-w-0 items-center gap-[9px]">
        <Dot tone={tone} />
        <span className="truncate">{children}</span>
      </span>
      <span className="font-mono text-xs text-rail-dim">{count}</span>
    </Link>
  );
}

/** Who is signed in, and the way out. Pinned to the bottom of the rail. */
export function RailUser({
  name,
  children,
}: {
  readonly name: string;
  readonly children?: ReactNode;
}): ReactElement {
  const initials = name
    .split(/\s+/)
    .filter((part) => part !== '')
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <div className="mt-auto flex items-center gap-2.5 border-t border-rail-line px-[18px] py-3.5">
      <span
        aria-hidden="true"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-rail-line text-xs font-semibold text-rail-bright"
      >
        {initials}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[13px] font-medium text-white">{name}</span>
        <span className="font-mono text-[10px] tracking-[0.1em] text-rail-dim uppercase">
          signed in
        </span>
      </span>
      {children !== undefined && <span className="ml-auto">{children}</span>}
    </div>
  );
}

/** A control on the dark pane — the way out, and nothing else so far. */
export function RailButton({
  busy = false,
  onClick,
  children,
}: {
  readonly busy?: boolean;
  readonly onClick?: () => void;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-busy={busy}
      className="rounded-md border border-rail-edge px-2 py-1 text-[11px] font-medium text-rail-dim hover:border-rail-dim hover:text-rail-bright disabled:cursor-progress"
    >
      {children}
    </button>
  );
}
