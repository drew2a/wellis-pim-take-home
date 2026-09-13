'use client';

// Two intakes from one patient on one day (ADR-0006). **Both rows stay whatever is decided** —
// neither is deleted and neither legacy outcome is rewritten, because what the legacy process
// recorded is evidence. The decision is which of them is the record of note, and that is written
// into the audit and onto the item rather than into either row.
import { useRouter } from 'next/navigation';
import { useState, type ReactElement } from 'react';

import {
  Button,
  ButtonRow,
  Caption,
  Card,
  Choice,
  ErrorText,
  NEEDS_A_NOTE,
  TextAreaField,
} from '@/ui';

export interface PairedIntake {
  readonly intakeId: string;
  readonly summary: string;
}

export function DuplicateDecision({
  itemId,
  intakes,
}: {
  readonly itemId: string;
  readonly intakes: readonly PairedIntake[];
}): ReactElement {
  const router = useRouter();
  const [chosen, setChosen] = useState('');
  const [note, setNote] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const send = async (body: Record<string, unknown>, label: string): Promise<void> => {
    setBusy(label);
    setFailure(null);
    try {
      const response = await fetch(`/api/console/items/${itemId}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ ...body, note }),
      });
      if (!response.ok) {
        const answer = (await response.json()) as { error?: string };
        setFailure(answer.error ?? 'that did not work');
        return;
      }
      router.push('/console');
      router.refresh();
    } catch {
      setFailure('the console could not be reached');
    } finally {
      setBusy(null);
    }
  };

  const noted = note.trim() !== '';

  return (
    <Card>
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
          {`${intake.intakeId} is the record of note — ${intake.summary}`}
        </Choice>
      ))}

      <TextAreaField
        label="Why"
        hint="Recorded against both intakes, whichever one you mark."
        rows={3}
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
        }}
        required
      />
      {failure !== null && <ErrorText>{failure}</ErrorText>}
      <Caption>Both intakes stay, and neither outcome changes.</Caption>
      <ButtonRow reason={noted ? undefined : NEEDS_A_NOTE}>
        <Button
          variant="primary"
          busy={busy === 'keep_one'}
          disabled={!noted || chosen === '' || busy !== null}
          onClick={() => {
            void send({ action: 'keep_one', intakeId: chosen }, 'keep_one');
          }}
        >
          Mark as the record of note
        </Button>
        <Button
          busy={busy === 'keep_both'}
          disabled={!noted || busy !== null}
          onClick={() => {
            void send({ action: 'keep_both' }, 'keep_both');
          }}
        >
          Two genuine submissions
        </Button>
      </ButtonRow>
    </Card>
  );
}
