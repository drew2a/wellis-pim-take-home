'use client';

// The three answers a vocabulary item takes, and — for the one item whose confirmation is a write —
// the rows the reviewer may take out before applying it.
//
// It posts what was chosen: the action, the note, the excluded ids. Which values follow is the
// server's to decide (R-T4); this component could not name a row to write if it wanted to.
import { useState, type ReactElement, type ReactNode } from 'react';

import { useDecide } from '@/app/console/useDecide';
import { Choice, DecisionBar, DetailBody, DetailSection, ENTER, Hint, NEEDS_A_NOTE } from '@/ui';

export interface ExcludableRow {
  readonly legacyId: string;
  readonly label: string;
  readonly keeping: string;
  readonly instead: string;
}

export function VocabularyDecision({
  itemId,
  after,
  rows,
  children,
}: {
  readonly itemId: string;
  readonly after: string;
  /** Empty unless confirming writes values, in which case each row may be taken out first. */
  readonly rows: readonly ExcludableRow[];
  readonly children: ReactNode;
}): ReactElement {
  const decide = useDecide(`/api/console/items/${itemId}/resolve`, after);
  const [excluded, setExcluded] = useState<readonly string[]>([]);
  const stopped = !decide.noted || decide.busy !== null;

  const toggle = (legacyId: string): void => {
    setExcluded((current) =>
      current.includes(legacyId)
        ? current.filter((each) => each !== legacyId)
        : [...current, legacyId],
    );
  };

  const act = (action: 'confirm' | 'reject' | 'dismiss'): void => {
    decide.send(action, { action, note: decide.note, excluded: [...excluded] });
  };

  return (
    <>
      <DetailBody>
        {children}
        {rows.length > 0 && (
          // This is the one place the console lets a reviewer exclude rows one by one — the
          // opposite of a bulk action: one decision, applied to the rows they kept.
          <DetailSection
            title={`Rows this writes (${rows.length - excluded.length} of ${rows.length})`}
          >
            <Hint>
              Confirming writes the value below to each row still ticked. Untick the ones it should
              not apply to.
            </Hint>
            {rows.map((row) => (
              <Choice
                key={row.legacyId}
                type="checkbox"
                checked={!excluded.includes(row.legacyId)}
                onChange={() => {
                  toggle(row.legacyId);
                }}
              >
                {`${row.label} — ${row.instead} (instead of ${row.keeping})`}
              </Choice>
            ))}
          </DetailSection>
        )}
      </DetailBody>
      <DecisionBar
        note={decide.note}
        onNote={decide.setNote}
        placeholder="Why — recorded against every row this decision touches, and against the item"
        unavailable={decide.noted ? undefined : NEEDS_A_NOTE}
        error={decide.failure}
        actions={[
          {
            label: 'Confirm',
            variant: 'primary',
            hint: ENTER,
            busy: decide.busy === 'confirm',
            disabled: stopped,
            onPick: () => {
              act('confirm');
            },
          },
          {
            label: 'Reject',
            hint: 'R',
            busy: decide.busy === 'reject',
            disabled: stopped,
            onPick: () => {
              act('reject');
            },
          },
          {
            label: 'Dismiss',
            variant: 'ghost',
            hint: 'D',
            busy: decide.busy === 'dismiss',
            disabled: stopped,
            onPick: () => {
              act('dismiss');
            },
          },
        ]}
      />
    </>
  );
}
