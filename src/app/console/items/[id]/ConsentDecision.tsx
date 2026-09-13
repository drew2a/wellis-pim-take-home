'use client';

// What a reviewer records about a consent item: what they did about it, not what the patient did.
// Nothing here writes a consent event — an event is the patient's act, and one written from this
// screen would be indistinguishable from a line of the log (`CLAUDE.md` §5).
import type { ReactElement, ReactNode } from 'react';

import { useDecide } from '@/app/console/useDecide';
import { DecisionBar, DetailBody, ENTER, NEEDS_A_NOTE, type DecisionAction } from '@/ui';

export function ConsentDecision({
  itemId,
  after,
  conflicted,
  children,
}: {
  readonly itemId: string;
  readonly after: string;
  /** True on the seven self-contradicting logs, the only ones a state may be established over. */
  readonly conflicted: boolean;
  readonly children: ReactNode;
}): ReactElement {
  const decide = useDecide(`/api/console/items/${itemId}/resolve`, after);
  const stopped = !decide.noted || decide.busy !== null;

  const establish = (state: 'granted' | 'revoked', hint: string): DecisionAction => ({
    label: `Consent is ${state}`,
    variant: state === 'granted' ? 'primary' : 'secondary',
    hint,
    busy: decide.busy === `set_state:${state}`,
    disabled: stopped,
    onPick: () => {
      decide.send(`set_state:${state}`, { action: 'set_state', state, note: decide.note });
    },
  });

  return (
    <>
      <DetailBody>{children}</DetailBody>
      <DecisionBar
        note={decide.note}
        onNote={decide.setNote}
        placeholder="What was done — the patient was contacted, consent was re-obtained on paper, processing was paused"
        unavailable={decide.noted ? undefined : NEEDS_A_NOTE}
        error={decide.failure}
        actions={[
          ...(conflicted ? [establish('granted', ENTER), establish('revoked', 'R')] : []),
          {
            label: 'Record it and close',
            variant: conflicted ? 'ghost' : 'primary',
            hint: conflicted ? 'C' : ENTER,
            busy: decide.busy === 'resolve',
            disabled: stopped,
            onPick: () => {
              decide.send('resolve', { action: 'resolve', note: decide.note });
            },
          },
          {
            label: 'Nothing to do',
            variant: 'ghost',
            hint: 'D',
            busy: decide.busy === 'dismiss',
            disabled: stopped,
            onPick: () => {
              decide.send('dismiss', { action: 'dismiss', note: decide.note });
            },
          },
        ]}
      />
    </>
  );
}
