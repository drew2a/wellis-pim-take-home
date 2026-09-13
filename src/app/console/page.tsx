// The console (R-C1). Today it is the door with a name on it; the work queue lands here next.
import type { ReactElement } from 'react';

import { requireReviewer } from '@/console/guard';
import { Badge, ButtonRow, Card, Hint, Page, PageTitle } from '@/ui';

import { SignOut } from './SignOut';

export const dynamic = 'force-dynamic';

export default async function ConsolePage(): Promise<ReactElement> {
  const reviewer = await requireReviewer();
  return (
    <Page>
      <PageTitle>Wellis review console</PageTitle>
      <Card>
        <p>
          Signed in as {reviewer.name} <Badge tone="info">{reviewer.role}</Badge>
        </p>
        <Hint>
          Every decision taken here is recorded against this name. The work queue is next.
        </Hint>
        <ButtonRow>
          <SignOut />
        </ButtonRow>
      </Card>
    </Page>
  );
}
