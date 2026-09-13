'use client';

// One value the mapper could not read, and the three ways a reviewer answers for it: take the
// detector's proposal, type a value, or leave the null with a note saying why (ADR-0005).
//
// A proposal is data on the item, never something the importer applied. Accepting one and typing a
// value are the same mechanism — the resolution path — and the screen says so rather than making
// "accept" look like a shortcut that skips the record.
//
// Some of these items have no row to correct at all — a consent event whose timestamp could not be
// read was never stored, and ADR-0007 does not let one be written. There the value form is not
// shown: offering a field and two buttons the server answers with a 400 walks a reviewer into a
// dead end (ADR-0026 item 2). `uncorrectable` says so in one line, and dismissing stays.
import { useRouter } from 'next/navigation';
import { useState, type ReactElement } from 'react';

import {
  Button,
  ButtonRow,
  Caption,
  Card,
  ErrorText,
  Hint,
  Raw,
  TextAreaField,
  TextField,
} from '@/ui';

export function ValueDecision({
  itemId,
  field,
  current,
  proposal,
  uncorrectable,
}: {
  readonly itemId: string;
  readonly field: string;
  readonly current: string | null;
  readonly proposal: { readonly value: string; readonly rule: string | null } | null;
  /** Why no value can be written, in one line, or null when one can. */
  readonly uncorrectable: string | null;
}): ReactElement {
  const router = useRouter();
  const [value, setValue] = useState('');
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

  if (uncorrectable !== null) {
    return (
      <Card>
        <Hint>{uncorrectable}</Hint>
        <TextAreaField
          label="Why"
          hint="Recorded against the row this item names, with your name."
          rows={3}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
          }}
          required
        />
        {failure !== null && <ErrorText>{failure}</ErrorText>}
        <ButtonRow>
          <Button
            variant="primary"
            busy={busy === 'dismiss'}
            disabled={!noted || busy !== null}
            onClick={() => {
              void send({ action: 'dismiss' }, 'dismiss');
            }}
          >
            Leave it empty
          </Button>
        </ButtonRow>
      </Card>
    );
  }

  return (
    <Card>
      <Caption>
        {field} is now {current ?? 'empty'}. The raw value is kept either way.
      </Caption>
      {proposal !== null && (
        <Hint>
          {`The detector proposes ${proposal.value}`}
          {proposal.rule === null ? '.' : ` (${proposal.rule}).`}
        </Hint>
      )}

      <TextField
        label="Or a value you establish"
        hint="Leave empty to use one of the buttons below instead."
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
        }}
      />
      <TextAreaField
        label="Why"
        hint="Recorded with the field, the old value and the new one."
        rows={3}
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
        }}
        required
      />
      {failure !== null && <ErrorText>{failure}</ErrorText>}
      <Caption>
        Every one of these writes the same record: the value, an audit entry naming you, and your
        note. A value you set here is yours, and no later import overwrites it.
      </Caption>
      <ButtonRow>
        {proposal !== null && (
          <Button
            variant="primary"
            busy={busy === 'accept'}
            disabled={!noted || busy !== null}
            onClick={() => {
              void send({ action: 'accept_proposal' }, 'accept');
            }}
          >
            Accept <Raw>{proposal.value}</Raw>
          </Button>
        )}
        <Button
          variant={proposal === null ? 'primary' : 'secondary'}
          busy={busy === 'set'}
          disabled={!noted || value.trim() === '' || busy !== null}
          onClick={() => {
            void send({ action: 'set_value', value: value.trim() }, 'set');
          }}
        >
          Use the value above
        </Button>
        <Button
          busy={busy === 'dismiss'}
          disabled={!noted || busy !== null}
          onClick={() => {
            void send({ action: 'dismiss' }, 'dismiss');
          }}
        >
          Leave it empty
        </Button>
      </ButtonRow>
    </Card>
  );
}
