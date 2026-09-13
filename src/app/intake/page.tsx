// The patient intake flow (R-B1). A server component so the bounds the form shows come from the
// server's own sources — `rules/v1.json`, which the engine and the importer also read, and the
// day the API measures an age against — rather than being repeated in the browser; everything the
// patient types is validated again by the API (R-T4).
import type { ReactElement } from 'react';

import { dobBounds } from '@/intake/answers';
import { todayIso } from '@/intake/today';
import { currentRules } from '@/rules/load';
import { Lead, Page, PageTitle } from '@/ui';

import { IntakeForm } from './IntakeForm';

export const dynamic = 'force-dynamic';

export default function IntakePage(): ReactElement {
  const { plausibility } = currentRules();
  return (
    <Page>
      <PageTitle>Wellis intake</PageTitle>
      <Lead>
        A few questions about you and your health. A member of our care team reads every answer;
        nothing here is a medical decision on its own.
      </Lead>
      <IntakeForm
        bounds={{
          heightCm: plausibility.height_cm,
          weightKg: plausibility.weight_kg,
          // Derived per request, on the server, from the same day the API validates against.
          dob: dobBounds(todayIso()),
        }}
      />
    </Page>
  );
}
