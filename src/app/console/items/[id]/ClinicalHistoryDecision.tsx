'use client';

// What a reviewer does about something the legacy process could not see. There is no button that
// revisits the outcome: the historical decision stands, and the record of what was done about it
// today sits beside it (ADR-0014 item 7, `CLAUDE.md` §5).
import type { ReactElement, ReactNode } from 'react';

import { useDecide } from '@/app/console/useDecide';
import { DecisionBar, DetailBody, ENTER, NEEDS_A_NOTE } from '@/ui';

export function ClinicalHistoryDecision({
  itemId,
  after,
  placeholder,
  children,
}: {
  readonly itemId: string;
  readonly after: string;
  /**
   * The actions a reviewer picks from when they write the reason. Per rule rather than per kind:
   * what is done about a minor approved in 2024 is not what is done about a GLP-1 medication.
   */
  readonly placeholder: string;
  readonly children: ReactNode;
}): ReactElement {
  const decide = useDecide(`/api/console/items/${itemId}/resolve`, after);
  const held = decide.noted ? undefined : NEEDS_A_NOTE;

  return (
    <>
      <DetailBody>{children}</DetailBody>
      <DecisionBar
        note={decide.note}
        onNote={decide.setNote}
        placeholder={placeholder}
        unavailable={held}
        error={decide.failure}
        actions={[
          {
            label: 'Record it and close',
            variant: 'primary',
            hint: ENTER,
            busy: decide.busy === 'resolve',
            disabled: !decide.noted || decide.busy !== null,
            onPick: () => {
              decide.send('resolve', { action: 'resolve', note: decide.note });
            },
          },
          {
            label: 'No action needed',
            hint: 'D',
            busy: decide.busy === 'dismiss',
            disabled: !decide.noted || decide.busy !== null,
            onPick: () => {
              decide.send('dismiss', { action: 'dismiss', note: decide.note });
            },
          },
        ]}
      />
    </>
  );
}
