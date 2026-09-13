'use client';

// Two intakes from one patient on one day (ADR-0006). **Both rows stay whatever is decided** —
// neither is deleted and neither legacy outcome is rewritten, because what the legacy process
// recorded is evidence. The decision is which of them is the record of note, and that is written
// into the audit and onto the item rather than into either row.
import { useState, type ReactElement, type ReactNode } from 'react';

import { useDecide } from '@/app/console/useDecide';
import { Choice, DecisionBar, DetailBody, DetailSection, ENTER, Hint, NEEDS_A_NOTE } from '@/ui';

export interface PairedIntake {
  readonly intakeId: string;
  readonly summary: string;
}

export function DuplicateDecision({
  itemId,
  after,
  intakes,
  children,
}: {
  readonly itemId: string;
  readonly after: string;
  readonly intakes: readonly PairedIntake[];
  readonly children: ReactNode;
}): ReactElement {
  const decide = useDecide(`/api/console/items/${itemId}/resolve`, after);
  const [chosen, setChosen] = useState('');
  const stopped = !decide.noted || decide.busy !== null;

  return (
    <>
      <DetailBody>
        {children}
        <DetailSection title="Which one is the record of note">
          {intakes.map((intake) => (
            <Choice
              key={intake.intakeId}
              type="radio"
              name="recordOfNote"
              checked={chosen === intake.intakeId}
              onChange={() => {
                setChosen(intake.intakeId);
              }}
            >
              {`${intake.intakeId} — ${intake.summary}`}
            </Choice>
          ))}
          <Hint>Both intakes stay, and neither outcome changes.</Hint>
        </DetailSection>
      </DetailBody>
      <DecisionBar
        note={decide.note}
        onNote={decide.setNote}
        placeholder="e.g. B is the resubmission after the form timed out"
        unavailable={
          !decide.noted
            ? NEEDS_A_NOTE
            : chosen === ''
              ? 'Pick the record of note above, or say that both are genuine.'
              : undefined
        }
        error={decide.failure}
        actions={[
          {
            label: 'Mark as the record of note',
            variant: 'primary',
            hint: ENTER,
            busy: decide.busy === 'keep_one',
            disabled: stopped || chosen === '',
            onPick: () => {
              decide.send('keep_one', {
                action: 'keep_one',
                intakeId: chosen,
                note: decide.note,
              });
            },
          },
          {
            label: 'Two genuine submissions',
            hint: 'B',
            busy: decide.busy === 'keep_both',
            disabled: stopped,
            onPick: () => {
              decide.send('keep_both', { action: 'keep_both', note: decide.note });
            },
          },
        ]}
      />
    </>
  );
}
