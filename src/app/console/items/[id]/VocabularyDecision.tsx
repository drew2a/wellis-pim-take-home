'use client';

// The three answers a vocabulary item takes, and — for the one item whose confirmation is a write —
// the rows the reviewer may take out before applying it.
//
// It posts what was chosen: the action, the note, the excluded ids. Which values follow is the
// server's to decide (R-T4); this component could not name a row to write if it wanted to.
import { useRouter } from 'next/navigation';
import { useState, type ReactElement } from 'react';

import {
  Button,
  ButtonRow,
  Card,
  Choice,
  ErrorText,
  Hint,
  NEEDS_A_NOTE,
  TextAreaField,
} from '@/ui';

export interface ExcludableRow {
  readonly legacyId: string;
  readonly label: string;
  readonly keeping: string;
  readonly instead: string;
}

type Action = 'confirm' | 'reject' | 'dismiss';

export function VocabularyDecision({
  itemId,
  question,
  rows,
}: {
  readonly itemId: string;
  /** What confirming means, in the reviewer's words, so the buttons are not bare yes/no. */
  readonly question: string;
  /** Empty unless confirming writes values, in which case each row may be taken out first. */
  readonly rows: readonly ExcludableRow[];
}): ReactElement {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [excluded, setExcluded] = useState<readonly string[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);

  const decide = async (action: Action): Promise<void> => {
    setBusy(action);
    setFailure(null);
    try {
      const response = await fetch(`/api/console/items/${itemId}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ action, note, excluded: [...excluded] }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setFailure(body.error ?? 'that did not work');
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

  const toggle = (legacyId: string): void => {
    setExcluded((current) =>
      current.includes(legacyId)
        ? current.filter((each) => each !== legacyId)
        : [...current, legacyId],
    );
  };

  return (
    <Card>
      {rows.length > 0 && (
        <>
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
          <Hint>{`${rows.length - excluded.length} of ${rows.length} rows will be written.`}</Hint>
        </>
      )}

      <TextAreaField
        label="Why"
        hint="Recorded against every row this decision touches, and against the item."
        rows={3}
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
        }}
        required
      />
      {failure !== null && <ErrorText>{failure}</ErrorText>}
      <Hint>{question}</Hint>
      <ButtonRow reason={note.trim() === '' ? NEEDS_A_NOTE : undefined}>
        <Button
          variant="primary"
          busy={busy === 'confirm'}
          disabled={note.trim() === '' || busy !== null}
          onClick={() => {
            void decide('confirm');
          }}
        >
          Confirm
        </Button>
        <Button
          busy={busy === 'reject'}
          disabled={note.trim() === '' || busy !== null}
          onClick={() => {
            void decide('reject');
          }}
        >
          Reject
        </Button>
        <Button
          busy={busy === 'dismiss'}
          disabled={note.trim() === '' || busy !== null}
          onClick={() => {
            void decide('dismiss');
          }}
        >
          Dismiss
        </Button>
      </ButtonRow>
    </Card>
  );
}
