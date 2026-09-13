'use client';

// What a reviewer records about a consent item: what they did about it, not what the patient did.
// Nothing here writes a consent event — an event is the patient's act, and one written from this
// screen would be indistinguishable from a line of the log (`CLAUDE.md` §5).
import { useRouter } from 'next/navigation';
import { useState, type ReactElement } from 'react';

import { Button, ButtonRow, Caption, Card, ErrorText, TextAreaField } from '@/ui';

export function ConsentDecision({
  itemId,
  pendingDecision,
}: {
  readonly itemId: string;
  /** Shown on the seven self-contradicting logs, where establishing the state waits on ADR-0025. */
  readonly pendingDecision: boolean;
}): ReactElement {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const send = async (action: string): Promise<void> => {
    setBusy(action);
    setFailure(null);
    try {
      const response = await fetch(`/api/console/items/${itemId}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ action, note }),
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
      {pendingDecision && (
        <Caption>
          This log contradicts itself, so no rule can say what is true. Setting the state by hand is
          not built yet — see ADR-0025 — so for now record what you did and leave the state as it
          is.
        </Caption>
      )}
      <TextAreaField
        label="What was done"
        hint="The patient was contacted, consent was re-obtained on paper, processing was paused."
        rows={3}
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
        }}
        required
      />
      {failure !== null && <ErrorText>{failure}</ErrorText>}
      <Caption>
        Recorded against the patient. No consent event is written: the log is what the patient did.
      </Caption>
      <ButtonRow>
        <Button
          variant="primary"
          busy={busy === 'resolve'}
          disabled={!noted || busy !== null}
          onClick={() => {
            void send('resolve');
          }}
        >
          Record it and close
        </Button>
        <Button
          busy={busy === 'dismiss'}
          disabled={!noted || busy !== null}
          onClick={() => {
            void send('dismiss');
          }}
        >
          Nothing to do
        </Button>
      </ButtonRow>
    </Card>
  );
}
