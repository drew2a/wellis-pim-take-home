'use client';

// Claiming an intake, and deciding it (R-C8). The buttons a reviewer cannot use are absent, and
// that is a courtesy: the server refuses the same move with the machine's own words, and this
// component could not talk its way past it (R-T4, ADR-0014 item 3).
import { useRouter } from 'next/navigation';
import { useState, type ReactElement } from 'react';

import {
  Button,
  ButtonRow,
  Caption,
  Card,
  ErrorText,
  Hint,
  NEEDS_A_NOTE,
  TextAreaField,
} from '@/ui';

export function IntakeDecision({
  intakeId,
  canClaim,
  canDecide,
  approvalBlockedBy,
}: {
  readonly intakeId: string;
  readonly canClaim: boolean;
  /** True once a named person has it: `in_review` is the only state a decision is taken from. */
  readonly canDecide: boolean;
  /** The rules the ruleset calls absolute that this intake matched, if any (Q1). */
  readonly approvalBlockedBy: readonly string[];
}): ReactElement {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const move = async (to: string): Promise<void> => {
    setBusy(to);
    setFailure(null);
    try {
      const response = await fetch(`/api/console/intakes/${intakeId}/transition`, {
        method: 'POST',
        body: JSON.stringify(to === 'in_review' ? { to } : { to, note }),
      });
      if (!response.ok) {
        const answer = (await response.json()) as { error?: string };
        setFailure(answer.error ?? 'that did not work');
        return;
      }
      router.refresh();
    } catch {
      setFailure('the console could not be reached');
    } finally {
      setBusy(null);
    }
  };

  const blocked = approvalBlockedBy.length > 0;

  if (canClaim) {
    return (
      <Card>
        <Hint>
          Claiming puts your name on this intake. Nobody else can then claim it, and the audit says
          who looked at it and when.
        </Hint>
        {failure !== null && <ErrorText>{failure}</ErrorText>}
        <ButtonRow>
          <Button
            variant="primary"
            busy={busy === 'in_review'}
            onClick={() => {
              void move('in_review');
            }}
          >
            Claim for review
          </Button>
        </ButtonRow>
      </Card>
    );
  }

  if (!canDecide) {
    return (
      <Card>
        <Caption>
          This intake takes no decision from here. The legacy process decided it, and this console
          does not rewrite what it decided — a disagreement with today&rsquo;s rules is a clinical
          history item.
        </Caption>
      </Card>
    );
  }

  return (
    <Card>
      {blocked && (
        <Caption>
          {`The rules rejected this absolutely (${approvalBlockedBy.join(', ')}), which a reviewer
            cannot resolve in the patient's favour. Rejecting, and leaving it open, are still
            yours.`}
        </Caption>
      )}
      <TextAreaField
        label="Your decision, in a sentence"
        hint="Recorded as the reason on the audit entry, with your name and the time."
        rows={3}
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
        }}
        required
      />
      {failure !== null && <ErrorText>{failure}</ErrorText>}
      <ButtonRow reason={note.trim() === '' ? NEEDS_A_NOTE : undefined}>
        <Button
          variant="primary"
          busy={busy === 'approved'}
          disabled={note.trim() === '' || blocked || busy !== null}
          onClick={() => {
            void move('approved');
          }}
        >
          Approve
        </Button>
        <Button
          variant="danger"
          busy={busy === 'rejected'}
          disabled={note.trim() === '' || busy !== null}
          onClick={() => {
            void move('rejected');
          }}
        >
          Reject
        </Button>
      </ButtonRow>
    </Card>
  );
}
