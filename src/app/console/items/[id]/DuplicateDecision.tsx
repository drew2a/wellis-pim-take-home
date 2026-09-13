'use client';

// Two intakes from one patient on one day (ADR-0006). **Both rows stay whatever is decided** —
// neither is deleted and neither legacy outcome is rewritten, because what the legacy process
// recorded is evidence. The decision is which of them is the record of note, and that is written
// into the audit and onto the item rather than into either row.
//
// Because both rows stay, the comparison is read-only and the choice sits on the column heading:
// what a reviewer decides here is about a whole record, not about a field of it.
import { useState, type ReactElement, type ReactNode } from 'react';

import { useDecide } from '@/app/console/useDecide';
import { CompareCard, DecisionBar, DetailBody, ENTER, NEEDS_A_NOTE, type CompareRow } from '@/ui';

export interface PairedIntake {
  readonly intakeId: string;
  /** The payload's row for this intake, as jsonb gave it. */
  readonly fields: Record<string, unknown>;
}

export function DuplicateDecision({
  itemId,
  after,
  intakes,
  rows,
  children,
}: {
  readonly itemId: string;
  readonly after: string;
  /** The two intake ids, in payload order — the columns of the comparison. */
  readonly intakes: readonly string[];
  readonly rows: readonly CompareRow[];
  readonly children: ReactNode;
}): ReactElement {
  const decide = useDecide(`/api/console/items/${itemId}/resolve`, after);
  const [chosen, setChosen] = useState('');
  const stopped = !decide.noted || decide.busy !== null;

  return (
    <>
      <DetailBody>
        {children}
        <CompareCard
          title="The two intakes — pick the record of note"
          name="recordOfNote"
          columns={intakes.map((intakeId) => ({
            label: intakeId,
            checked: chosen === intakeId,
            onPick: () => {
              setChosen(intakeId);
            },
          }))}
          rows={rows}
        />
      </DetailBody>
      <DecisionBar
        note={decide.note}
        onNote={decide.setNote}
        placeholder="e.g. B is the resubmission after the form timed out"
        unavailable={
          !decide.noted
            ? NEEDS_A_NOTE
            : chosen === ''
              ? 'Tick the record of note above, or say that both are genuine. Neither row is deleted or altered either way, and neither outcome changes.'
              : undefined
        }
        error={decide.failure}
        actions={[
          {
            label: chosen === '' ? 'Mark as the record of note' : `${chosen} is the record`,
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
