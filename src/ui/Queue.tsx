'use client';

// The console's middle pane (ADR-0028): the queue, always on screen, so deciding an item never
// costs a reviewer their place in the work.
//
// `'use client'` for three things it does to a page the server already rendered — narrow it by
// text, flip the age inside each group, and move through it with `j`/`k`. None of them is a second
// read of the database: the rows arrive as props from `ConsoleShell`, which read them through
// `@/repo/queue`.
// Anything that changes what the *query* returns — the scope, the age — stays a link, because the
// queue's filters are the URL (ADR-0024).
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';

import type { QueueKind } from '@/repo/queue';

import { ordered } from './queue-order';
import { Dot } from './Rail';
import type { Tone } from './tones';

/** One row, as the queue needs it: what it says, where it goes, and what it can be matched on. */
export interface QueueItem {
  readonly key: string;
  /** Which group the row is in — the toggle flips the age inside a group, never across them. */
  readonly kind: QueueKind;
  readonly href: string;
  readonly tone: Tone;
  readonly kindLabel: string;
  readonly title: string;
  /** The patient, or what stands in for one — "no patient", "applies to 18 rows". */
  readonly patient: string;
  readonly date: string;
  /** Everything the text filter matches on, already lowercased by the caller. */
  readonly haystack: string;
}

/** One filter, as a link: the scope and the age are query parameters, not client state. */
export interface QueueChoice {
  readonly label: string;
  readonly href: string;
  readonly selected: boolean;
}

const PILL = 'rounded-md px-[11px] py-[5px] text-[12.5px] font-medium no-underline';

function ScopePill({ choice }: { readonly choice: QueueChoice }): ReactElement {
  return (
    <Link
      href={choice.href}
      aria-current={choice.selected ? 'true' : undefined}
      className={`${PILL} border ${
        choice.selected
          ? 'border-grey-900 bg-grey-900 text-white'
          : 'border-grey-200 bg-white text-grey-500 hover:bg-grey-50'
      }`}
    >
      {choice.label}
    </Link>
  );
}

function AgePill({ choice }: { readonly choice: QueueChoice }): ReactElement {
  return (
    <Link
      href={choice.href}
      aria-current={choice.selected ? 'true' : undefined}
      className={`rounded-md px-2 py-[3px] text-[12px] no-underline ${
        choice.selected ? 'bg-accent-50 text-accent-700' : 'text-grey-500 hover:bg-grey-50'
      }`}
    >
      {choice.label}
    </Link>
  );
}

function Row({
  item,
  selected,
}: {
  readonly item: QueueItem;
  readonly selected: boolean;
}): ReactElement {
  return (
    <Link
      href={item.href}
      aria-current={selected ? 'true' : undefined}
      className={`flex gap-[11px] border-b border-hairline px-4 py-[13px] no-underline ${
        selected ? 'bg-picked' : 'bg-white hover:bg-grey-50'
      }`}
    >
      <span
        aria-hidden="true"
        className={`w-0.5 shrink-0 self-stretch rounded-full ${selected ? 'bg-accent-600' : 'bg-transparent'}`}
      />
      <span className="flex min-w-0 flex-col gap-[3px]">
        <span className="flex items-center gap-[7px]">
          <Dot tone={item.tone} size={6} />
          <span className="font-mono text-[10px] tracking-[0.1em] text-grey-600 uppercase">
            {item.kindLabel}
          </span>
          <span className="ml-auto pl-2 font-mono text-[11px] text-grey-500">{item.date}</span>
        </span>
        <span className="text-[13.5px] leading-[19px] font-medium text-pretty text-grey-900">
          {item.title}
        </span>
        <span className="truncate text-[12.5px] text-grey-600">{item.patient}</span>
      </span>
    </Link>
  );
}

export function QueuePane({
  title,
  rows,
  selectedHref,
  scopes,
  ages,
  footnote,
}: {
  readonly title: string;
  readonly rows: readonly QueueItem[];
  /** The row the detail pane is showing, or null on the queue's own landing screen. */
  readonly selectedHref: string | null;
  readonly scopes: readonly QueueChoice[];
  readonly ages: readonly QueueChoice[];
  /** What the list owes the reader about what is not in it — the page cap, the ordering. */
  readonly footnote: ReactNode;
}): ReactElement {
  const router = useRouter();
  const [text, setText] = useState('');
  const [newestFirst, setNewestFirst] = useState(false);

  const shown = useMemo(() => {
    const needle = text.trim().toLowerCase();
    const matched = needle === '' ? rows : rows.filter((row) => row.haystack.includes(needle));
    return ordered(matched, newestFirst);
  }, [rows, text, newestFirst]);

  // `j`/`k` move through the list as rendered — filtered and ordered — which is the list the
  // reviewer is looking at. A keystroke inside the filter box is text, not navigation.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'j' && event.key !== 'k') return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const at = shown.findIndex((row) => row.href === selectedHref);
      const next =
        shown[Math.min(shown.length - 1, Math.max(0, at + (event.key === 'j' ? 1 : -1)))];
      if (next !== undefined && next.href !== selectedHref) router.push(next.href);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [shown, selectedHref, router]);

  return (
    <section className="flex min-h-0 min-w-0 flex-col border-r border-grey-200 bg-white">
      <header className="flex flex-col gap-3 border-b border-grey-100 p-4 pb-3">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-[17px] font-semibold tracking-tight text-grey-900">{title}</h1>
          <span className="font-mono text-xs whitespace-nowrap text-grey-600">
            {shown.length} shown
          </span>
        </div>

        <div className="flex gap-1.5">
          <input
            type="search"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
            placeholder="Filter by patient, id or rule"
            aria-label="Filter the rows on this page"
            className="min-w-0 flex-1 rounded-[7px] border border-grey-200 bg-grey-50 px-2.5 py-[7px] text-[13px] text-grey-900 placeholder:text-grey-400 focus:border-accent-600 focus:bg-white focus:outline-none"
          />
          <button
            type="button"
            onClick={() => {
              setNewestFirst((on) => !on);
            }}
            aria-pressed={newestFirst}
            className="rounded-[7px] border border-grey-200 bg-white px-2.5 py-[7px] text-[13px] font-medium whitespace-nowrap text-grey-700 hover:bg-grey-50"
          >
            {newestFirst ? 'Newest first' : 'Oldest first'}
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {scopes.map((scope) => (
            <ScopePill key={scope.label} choice={scope} />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <span className="pr-1 font-mono text-[10px] tracking-[0.12em] text-grey-600 uppercase">
            age
          </span>
          {ages.map((age) => (
            <AgePill key={age.label} choice={age} />
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-grey-500">
            {rows.length === 0
              ? 'Nothing matches these filters.'
              : 'Nothing on this page matches that text.'}
          </p>
        ) : (
          shown.map((row) => <Row key={row.key} item={row} selected={row.href === selectedHref} />)
        )}
        <p className="px-4 pt-3.5 pb-7 text-xs text-pretty text-grey-500">{footnote}</p>
      </div>
    </section>
  );
}
