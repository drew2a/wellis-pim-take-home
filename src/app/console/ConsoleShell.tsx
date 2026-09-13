// The console's three panes, and the one place they are assembled (ADR-0028).
//
// A server component, composed by every screen under `/console` rather than installed as a
// `layout.tsx`: a layout receives neither `searchParams` nor the dynamic params of the route below
// it, and the rail's counts *are* the search params while the row to mark *is* the child's `[id]`.
// Composing it keeps every pane a server component reading through `@/repo/queue` (ADR-0024).
//
// `detail` is a function rather than a node because the detail pane needs something only the shell
// knows: where this row sits in the queue behind it, and what ↑ and ↓ point at.
import type { ReactElement, ReactNode } from 'react';

import type { ConsoleReviewer } from '@/console/reviewer';
import { getDb } from '@/db/client';
import { dayOf } from '@/intake/today';
import { queueCounts, queuePage, type QueueRow } from '@/repo/queue';
import {
  ConsoleFrame,
  QueuePane,
  Rail,
  RailBrand,
  RailKind,
  RailKinds,
  RailLabel,
  RailNav,
  RailNavLink,
  RailUser,
  titled,
  toneForReviewItem,
  toneForState,
  type QueueChoice,
  type QueueItem,
} from '@/ui';

import { hrefOf, placeIn, type QueuePlace, type Selection } from './place';
import { SignOut } from './SignOut';
import {
  filtersFrom,
  ITEM_TYPE_ORDER,
  queryOf,
  STATE_ORDER,
  toggled,
  withParam,
  type SearchParams,
} from './queue-filters';

/**
 * The three scopes, which are the three statuses a review item can be in. The canvas offers
 * "Mine"; nothing owns an item — roles were removed in ADR-0027 and claiming writes an audit entry
 * rather than an assignment — so the pill that would be a lie is the real third status instead
 * (ADR-0028 §3).
 */
const SCOPES = [
  ['open', 'Open'],
  ['resolved', 'Resolved'],
  ['dismissed', 'Dismissed'],
] as const;

const AGES = [
  [undefined, 'any'],
  ['today', 'today'],
  ['week', 'this week'],
  ['older', 'older'],
] as const;

/** Everything the queue's text filter matches a row on, lowercased once here. */
const haystackOf = (row: QueueRow): string =>
  [row.title, row.patientName ?? '', row.type, row.id].join(' ').toLowerCase();

export async function ConsoleShell({
  reviewer,
  params,
  selected,
  detail,
}: {
  readonly reviewer: ConsoleReviewer;
  readonly params: SearchParams;
  readonly selected: Selection | null;
  readonly detail: (place: QueuePlace) => ReactNode;
}): Promise<ReactElement> {
  const filters = filtersFrom(params);
  const db = getDb();
  const [page, counts] = await Promise.all([
    queuePage(db, filters),
    queueCounts(db, filters.status),
  ]);

  const query = queryOf(params);
  const rows = page.rows;
  const selectedHref = selected === null ? null : hrefOf(selected, query);
  const place = placeIn(rows, selected, query);

  const items: QueueItem[] = rows.map((row) => ({
    key: `${row.kind}:${row.id}`,
    href: hrefOf(row, query),
    tone: row.kind === 'intake' ? toneForState(row.type) : toneForReviewItem(row.type),
    kindLabel: titled(row.type),
    title: row.title,
    patient: row.patientName ?? (row.kind === 'intake' ? 'no patient' : '—'),
    date: row.age === null ? '—' : dayOf(row.age),
    haystack: haystackOf(row),
  }));

  // The whole queue, not the filtered one: a count next to a place in the product says how much
  // work is there, and does not move when the reviewer narrows the list below it.
  const waiting =
    Object.values(counts.items).reduce((total, n) => total + n, 0) +
    counts.intakes.auto_flagged +
    counts.intakes.in_review;

  const chosenTypes = new Set<string>(filters.types);
  const chosenStates = new Set<string>(filters.states);
  const narrowed = params.type !== undefined || params.state !== undefined;

  const scopes: QueueChoice[] = SCOPES.map(([status, label]) => ({
    label,
    href: withParam(params, 'status', status),
    selected: filters.status === status,
  }));

  const ages: QueueChoice[] = AGES.map(([age, label]) => ({
    label,
    href: withParam(params, 'age', age),
    selected: filters.age === age,
  }));

  return (
    <ConsoleFrame>
      <Rail>
        <RailBrand />
        <RailNav>
          <RailNavLink href="/console" selected={!narrowed} count={waiting}>
            Work queue
          </RailNavLink>
        </RailNav>

        <RailLabel>Open by kind</RailLabel>
        <RailKinds>
          {ITEM_TYPE_ORDER.map((type) => (
            <RailKind
              key={type}
              href={toggled(params, 'type', type)}
              tone={toneForReviewItem(type)}
              count={counts.items[type]}
              selected={narrowed && chosenTypes.has(type)}
            >
              {titled(type)}
            </RailKind>
          ))}
          {STATE_ORDER.map((state) => (
            <RailKind
              key={state}
              href={toggled(params, 'state', state)}
              tone={toneForState(state)}
              count={counts.intakes[state]}
              selected={narrowed && chosenStates.has(state)}
            >
              {titled(state)}
            </RailKind>
          ))}
        </RailKinds>

        <RailUser name={reviewer.name}>
          <SignOut />
        </RailUser>
      </Rail>

      <QueuePane
        title={narrowed ? 'Filtered queue' : 'Everything open'}
        rows={items}
        selectedHref={selectedHref}
        scopes={scopes}
        ages={ages}
        footnote={
          page.more
            ? `Oldest first. The oldest ${rows.length} are shown, which is a page and not the whole of it — the counts in the rail are over everything.`
            : 'Oldest first. The rail counts every open item and every intake; the scope above says which status this list is of.'
        }
      />

      {detail(place)}
    </ConsoleFrame>
  );
}
