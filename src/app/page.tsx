import Link from 'next/link';
import type { ReactElement } from 'react';

import { Card, Hint, Lead, Page, PageTitle } from '@/ui';

export default function Home(): ReactElement {
  return (
    <Page>
      <PageTitle>Wellis Intake</PageTitle>
      <Lead>Legacy import, the patient intake flow, and the review console.</Lead>
      <Card>
        <p>
          <Link href="/intake">Start an intake</Link> — the patient-facing questionnaire.
        </p>
        <Hint>
          The review console is not built yet; see <code>README.md</code> for what is in scope.
        </Hint>
      </Card>
    </Page>
  );
}
