'use client';

// What a reviewer records about a consent item: what they did about it, not what the patient did.
// Nothing here writes a consent event — an event is the patient's act, and one written from this
// screen would be indistinguishable from a line of the log (`CLAUDE.md` §5).
import { useRouter } from 'next/navigation';
import { useState, type ReactElement } from 'react';

import { Button, ButtonRow, Caption, Card, ErrorText, NEEDS_A_NOTE, TextAreaField } from '@/ui';

export function ConsentDecision({
  itemId,
  conflicted,
}: {
  readonly itemId: string;
  /** True on the seven self-contradicting logs, the only ones a state may be established over. */
  readonly conflicted: boolean;
}): ReactElement {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const send = async (action: string, state?: 'granted' | 'revoked'): Promise<void> => {
    setBusy(`${action}${state ?? ''}`);
    setFailure(null);
    try {
      const response = await fetch(`/api/console/items/${itemId}/resolve`, {
        method: 'POST',
        body: JSON.stringify(state === undefined ? { action, note } : { action, note, state }),
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
      {conflicted && (
        <Caption>
          This log contradicts itself — it revokes a consent that was never given — so no rule can
          say what is true. If you have established which it is, set it below. It holds until an
          event later than the ones you saw arrives, which is new evidence and takes over.
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
      <ButtonRow reason={noted ? undefined : NEEDS_A_NOTE}>
        {conflicted &&
          (['granted', 'revoked'] as const).map((state) => (
            <Button
              key={state}
              variant="primary"
              busy={busy === `set_state${state}`}
              disabled={!noted || busy !== null}
              onClick={() => {
                void send('set_state', state);
              }}
            >
              {`Consent is ${state}`}
            </Button>
          ))}
        <Button
          variant={conflicted ? 'secondary' : 'primary'}
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
