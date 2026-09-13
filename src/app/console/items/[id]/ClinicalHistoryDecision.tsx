'use client';

// What a reviewer does about something the legacy process could not see. There is no button that
// revisits the outcome: the historical decision stands, and the record of what was done about it
// today sits beside it (ADR-0014 item 7, `CLAUDE.md` §5).
import { useRouter } from 'next/navigation';
import { useState, type ReactElement } from 'react';

import { Button, ButtonRow, Caption, Card, ErrorText, NEEDS_A_NOTE, TextAreaField } from '@/ui';

export function ClinicalHistoryDecision({ itemId }: { readonly itemId: string }): ReactElement {
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
      <TextAreaField
        label="What was done"
        hint="The patient was contacted, the care plan was adjusted, no action was needed."
        rows={3}
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
        }}
        required
      />
      {failure !== null && <ErrorText>{failure}</ErrorText>}
      <Caption>
        The legacy outcome does not change. This is recorded against the intake, beside it.
      </Caption>
      <ButtonRow reason={noted ? undefined : NEEDS_A_NOTE}>
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
          No action needed
        </Button>
      </ButtonRow>
    </Card>
  );
}
