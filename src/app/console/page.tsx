// The work queue (R-C1, R-C2, R-C3): one screen, one table, every row one thing to do.
//
// A server component. It reads through `@/repo/queue` and renders; the query lives there, where a
// test can call it (ADR-0024). The filters are the URL, so a reviewer can keep a filtered queue in
// a tab and nothing here needs client state.
import Link from 'next/link';
import type { ReactElement } from 'react';

import { requireReviewer } from '@/console/guard';
import { getDb } from '@/db/client';
import { dayOf } from '@/intake/today';
import { queueCounts, queuePage, type QueueRow } from '@/repo/queue';
import {
  Badge,
  Caption,
  FilterGroup,
  FilterLink,
  FilterPanel,
  Hint,
  Page,
  PageHeader,
  StateBadge,
  Table,
  humanise,
  toneForReviewItem,
  type Column,
} from '@/ui';

import { SignOut } from './SignOut';
import {
  filtersFrom,
  ITEM_TYPE_ORDER,
  STATE_ORDER,
  toggled,
  withParam,
  type SearchParams,
} from './queue-filters';

export const dynamic = 'force-dynamic';

const AGES = [
  ['today', 'today'],
  ['week', 'this week'],
  ['older', 'older'],
] as const;

const STATUSES = ['open', 'resolved', 'dismissed'] as const;

const href = (row: QueueRow): string =>
  row.kind === 'intake' ? `/console/intakes/${row.id}` : `/console/items/${row.id}`;

function columns(): readonly Column<QueueRow>[] {
  return [
    {
      header: 'Type',
      cell: (row) =>
        row.kind === 'intake' ? (
          <StateBadge state={row.type} />
        ) : (
          <Badge tone={toneForReviewItem(row.type)}>{humanise(row.type)}</Badge>
        ),
    },
    { header: 'What', cell: (row) => <Link href={href(row)}>{row.title}</Link> },
    {
      header: 'Patient',
      cell: (row) =>
        row.patientId === null ? (
          <Caption>—</Caption>
        ) : (
          <Link href={`/console/patients/${row.patientId}`}>{row.patientName ?? 'unnamed'}</Link>
        ),
    },
    // The day, not "3 days ago": a reviewer scanning a queue is placing work against a calendar.
    { header: 'Age', cell: (row) => (row.age === null ? '—' : dayOf(row.age)) },
    { header: 'Status', cell: (row) => humanise(row.status) },
  ];
}

export default async function QueuePage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}): Promise<ReactElement> {
  const reviewer = await requireReviewer();
  const params = await searchParams;
  const filters = filtersFrom(params);
  const db = getDb();
  const [page, counts] = await Promise.all([
    queuePage(db, filters),
    queueCounts(db, filters.status),
  ]);

  const types = new Set<string>(filters.types);
  const states = new Set<string>(filters.states);

  return (
    <Page>
      <PageHeader title="Work queue">
        <Caption>{reviewer.name}</Caption>
        <SignOut />
      </PageHeader>

      <FilterPanel>
        <FilterGroup label="Items">
          {ITEM_TYPE_ORDER.map((type) => (
            <FilterLink
              key={type}
              href={toggled(params, 'type', type)}
              selected={types.has(type)}
              count={counts.items[type]}
            >
              {humanise(type)}
            </FilterLink>
          ))}
        </FilterGroup>
        <FilterGroup label="Intakes">
          {STATE_ORDER.map((state) => (
            <FilterLink
              key={state}
              href={toggled(params, 'state', state)}
              selected={states.has(state)}
              count={counts.intakes[state]}
            >
              {humanise(state)}
            </FilterLink>
          ))}
        </FilterGroup>
        <FilterGroup label="Status">
          {STATUSES.map((status) => (
            <FilterLink
              key={status}
              href={withParam(params, 'status', status)}
              selected={filters.status === status}
            >
              {status}
            </FilterLink>
          ))}
        </FilterGroup>
        <FilterGroup label="Age">
          <FilterLink
            href={withParam(params, 'age', undefined)}
            selected={filters.age === undefined}
          >
            any
          </FilterLink>
          {AGES.map(([age, label]) => (
            <FilterLink
              key={age}
              href={withParam(params, 'age', age)}
              selected={filters.age === age}
            >
              {label}
            </FilterLink>
          ))}
        </FilterGroup>
      </FilterPanel>

      <Table
        columns={columns()}
        rows={page.rows}
        rowKey={(row) => `${row.kind}:${row.id}`}
        empty="Nothing matches these filters."
      />
      {page.more && (
        <Hint>
          The oldest {page.rows.length} are shown, which is a page and not the whole of it. The
          counts above are over everything.
        </Hint>
      )}
      {/* The status filter is about review items; an intake's status is its state, which the
          Intakes row above selects. Said here rather than left to be discovered. */}
      <Hint>
        Status filters review items. An intake&rsquo;s status is its state — pick one under Intakes.
      </Hint>
    </Page>
  );
}
