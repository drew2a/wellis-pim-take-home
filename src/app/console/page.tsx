// The work queue (R-C1, R-C2, R-C3): the three panes with nothing open yet.
//
// A server component. Everything it shows is assembled by `ConsoleShell`, which reads through
// `@/repo/queue` (ADR-0024, ADR-0028); this page's whole job is to say that no row is selected.
// The filters are the URL, so a reviewer can keep a filtered queue in a tab and nothing here needs
// client state.
import type { ReactElement } from 'react';

import { requireReviewer } from '@/console/guard';
import { DetailEmpty, DetailPane } from '@/ui';

import { ConsoleShell } from './ConsoleShell';
import { type SearchParams } from './queue-filters';

export const dynamic = 'force-dynamic';

export default async function QueuePage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}): Promise<ReactElement> {
  const reviewer = await requireReviewer();
  const params = await searchParams;

  return (
    <ConsoleShell
      reviewer={reviewer}
      params={params}
      selected={null}
      detail={() => (
        <DetailPane>
          <DetailEmpty title="Nothing open yet">
            Pick a row on the left. The rail counts every kind of open work, and the scope says
            which status the list is of — an intake&rsquo;s status is its state, and those are the
            kinds below the items.
          </DetailEmpty>
        </DetailPane>
      )}
    />
  );
}
