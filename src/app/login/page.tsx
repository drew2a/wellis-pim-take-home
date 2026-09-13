// The console's front door (ADR-0021). A server component, so the list of reviewers comes from the
// `reviewers` table rather than from anything the browser could invent — the login route checks it
// again anyway, and would refuse an id that is not in it.
import type { ReactElement } from 'react';

import { getDb } from '@/db/client';
import { listReviewers } from '@/reviewers/repo';
import { Lead, Page, PageTitle } from '@/ui';

import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage(): Promise<ReactElement> {
  const team = await listReviewers(getDb());
  return (
    <Page>
      <PageTitle>Wellis review console</PageTitle>
      <Lead>
        Patient records, intakes waiting for a decision, and everything the import could not decide
        on its own.
      </Lead>
      <LoginForm reviewers={team} />
    </Page>
  );
}
