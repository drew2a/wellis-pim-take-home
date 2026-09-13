'use client';

// One value the mapper could not read, and the three ways a reviewer answers for it: take the
// detector's proposal, type a value, or leave the null with a note saying why (ADR-0005).
//
// A proposal is data on the item, never something the importer applied. Accepting one and typing a
// value are the same mechanism — the resolution path — and the screen says so rather than making
// "accept" look like a shortcut that skips the record.
//
// Some of these items have no row to correct at all — a consent event whose timestamp could not be
// read was never stored, and ADR-0007 does not let one be written. There the value field is not
// shown: offering a field and two buttons the server answers with a 400 walks a reviewer into a
// dead end (ADR-0026 item 2). `uncorrectable` says so in one line, and dismissing stays.
import { useState, type ReactElement, type ReactNode } from 'react';

import { useDecide } from '@/app/console/useDecide';
import {
  DecisionBar,
  DetailBody,
  DetailSection,
  ENTER,
  Hint,
  NEEDS_A_NOTE,
  TextField,
  type DecisionAction,
} from '@/ui';

export function ValueDecision({
  itemId,
  after,
  field,
  proposal,
  uncorrectable,
  children,
}: {
  readonly itemId: string;
  readonly after: string;
  readonly field: string;
  readonly proposal: { readonly value: string; readonly rule: string | null } | null;
  /** Why no value can be written, in one line, or null when one can. */
  readonly uncorrectable: string | null;
  readonly children: ReactNode;
}): ReactElement {
  const decide = useDecide(`/api/console/items/${itemId}/resolve`, after);
  const [value, setValue] = useState('');
  const stopped = !decide.noted || decide.busy !== null;

  const leave: DecisionAction = {
    label: 'Leave it empty',
    variant: uncorrectable === null ? 'ghost' : 'primary',
    hint: uncorrectable === null ? 'D' : ENTER,
    busy: decide.busy === 'dismiss',
    disabled: stopped,
    onPick: () => {
      decide.send('dismiss', { action: 'dismiss', note: decide.note });
    },
  };

  const actions: readonly DecisionAction[] =
    uncorrectable !== null
      ? [leave]
      : [
          ...(proposal === null
            ? []
            : [
                {
                  label: `Accept ${proposal.value}`,
                  variant: 'primary' as const,
                  hint: ENTER,
                  busy: decide.busy === 'accept',
                  disabled: stopped,
                  onPick: () => {
                    decide.send('accept', { action: 'accept_proposal', note: decide.note });
                  },
                },
              ]),
          {
            label: 'Use the value above',
            variant: proposal === null ? ('primary' as const) : ('secondary' as const),
            hint: proposal === null ? ENTER : 'V',
            busy: decide.busy === 'set',
            disabled: stopped || value.trim() === '',
            onPick: () => {
              decide.send('set', {
                action: 'set_value',
                value: value.trim(),
                note: decide.note,
              });
            },
          },
          leave,
        ];

  return (
    <>
      <DetailBody>
        {children}
        {uncorrectable === null ? (
          <DetailSection title="A value you establish">
            <TextField
              label={field}
              hint="Only “Use the value above” reads this field; the other buttons ignore it. A value you set here is yours, and no later import overwrites it."
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
              }}
            />
          </DetailSection>
        ) : (
          <DetailSection title="Nothing to correct">
            <Hint>{uncorrectable}</Hint>
          </DetailSection>
        )}
      </DetailBody>
      <DecisionBar
        note={decide.note}
        onNote={decide.setNote}
        placeholder="Why — recorded with the field, the old value and the new one"
        unavailable={decide.noted ? undefined : NEEDS_A_NOTE}
        error={decide.failure}
        actions={actions}
      />
    </>
  );
}
