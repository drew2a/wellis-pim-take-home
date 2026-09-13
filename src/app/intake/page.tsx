// The patient intake flow (R-B1). A server component so the plausibility bounds come from
// `rules/v1.json` — the same file the engine and the importer read — rather than being repeated in
// the browser; everything the patient types is validated again by the API (R-T4).
import type { ReactElement } from 'react';

import { currentRules } from '@/rules/load';

import { IntakeForm } from './IntakeForm';

export const dynamic = 'force-dynamic';

export default function IntakePage(): ReactElement {
  const { plausibility } = currentRules();
  return (
    <main>
      <h1>Wellis intake</h1>
      <p>
        A few questions about you and your health. A member of our care team reads every answer;
        nothing here is a medical decision on its own.
      </p>
      <IntakeForm bounds={{ heightCm: plausibility.height_cm, weightKg: plausibility.weight_kg }} />
    </main>
  );
}
