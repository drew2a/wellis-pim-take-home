import Link from 'next/link';
import type { ReactElement } from 'react';

import { Card, Page, PageTitle, Stack } from '@/ui';

export default function Home(): ReactElement {
  return (
    <Page>
      <PageTitle>Wellis Intake</PageTitle>
      <Card>
        <Stack>
          <p>
            <Link href="/intake">Start an intake</Link> — the patient-facing questionnaire.
          </p>
          <p>
            <Link href="/console">Review console</Link> — for the care team; asks for the console
            secret.
          </p>
        </Stack>
      </Card>
    </Page>
  );
}
