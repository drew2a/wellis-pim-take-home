'use client';

// Two records side by side, and the decision a person takes about them (R-C4, R-C5, R-C6).
//
// Per field the reviewer picks a record or types a value. Picking a record posts **which record**,
// never the value shown: `bsn` is masked on this screen, and a form that sent back what it
// displayed would write `******333` into the column. The server reads the value from the row that
// was named (ADR-0022).
import { useRouter } from 'next/navigation';
import { useState, type ReactElement } from 'react';

import {
  Button,
  ButtonRow,
  Caption,
  Card,
  Choice,
  ErrorText,
  Hint,
  TextAreaField,
  TextField,
} from '@/ui';

export interface DecisionRow {
  readonly field: string;
  readonly values: readonly (string | null)[];
  readonly differs: boolean;
  readonly decidable: boolean;
}

export interface DecisionCandidate {
  readonly patientId: string;
  readonly label: string;
  readonly intakeCount: number;
  readonly consent: string;
  readonly legacyIds: readonly string[];
}

type Pick = { readonly index: number } | { readonly edited: string };

export function IdentityDecision({
  itemId,
  candidates,
  rows,
}: {
  readonly itemId: string;
  readonly candidates: readonly DecisionCandidate[];
  readonly rows: readonly DecisionRow[];
}): ReactElement {
  const router = useRouter();
  const [survivor, setSurvivor] = useState(0);
  const [picks, setPicks] = useState<Readonly<Record<string, Pick>>>({});
  const [note, setNote] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loser = survivor === 0 ? 1 : 0;

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

  const decisions = (): Record<string, unknown> => {
    const chosen: Record<string, unknown> = {};
    for (const [field, pick] of Object.entries(picks)) {
      if ('edited' in pick) chosen[field] = { source: 'edited', value: pick.edited };
      else chosen[field] = { source: pick.index === survivor ? 'survivor' : 'loser' };
    }
    return chosen;
  };

  const survivorId = candidates[survivor]?.patientId ?? '';
  const loserId = candidates[loser]?.patientId ?? '';
  const ready = note.trim() !== '' && busy === null;

  if (candidates.length < 2) {
    return (
      <Card>
        <ErrorText>
          This item no longer has two records to compare. One of them may already have been merged.
        </ErrorText>
      </Card>
    );
  }

  return (
    <Card>
      <Hint>
        Pick the record that survives. Then, for any field they disagree on, pick which value the
        surviving record keeps — or type one. A field you leave alone keeps the survivor&rsquo;s
        value, and fills in from the other record only where the survivor has none.
      </Hint>

      {candidates.map((candidate, index) => (
        <Choice
          key={candidate.patientId}
          type="radio"
          name="survivor"
          checked={survivor === index}
          onChange={() => {
            setSurvivor(index);
          }}
        >
          {`${candidate.label} survives — ${String(candidate.intakeCount)} intakes, consent ${candidate.consent}`}
        </Choice>
      ))}

      {rows.map((row) => (
        <div key={row.field}>
          <Caption>
            {row.field}
            {row.differs ? ' — they disagree' : ''}
          </Caption>
          {row.decidable ? (
            <>
              {row.values.map((value, index) => (
                <Choice
                  key={candidates[index]?.patientId ?? String(index)}
                  type="radio"
                  name={`field-${row.field}`}
                  checked={(picks[row.field] as { index?: number } | undefined)?.index === index}
                  onChange={() => {
                    setPicks({ ...picks, [row.field]: { index } });
                  }}
                >
                  {value ?? '—'}
                </Choice>
              ))}
              <TextField
                label=""
                placeholder="or type a value"
                value={(picks[row.field] as { edited?: string } | undefined)?.edited ?? ''}
                onChange={(e) => {
                  setPicks({ ...picks, [row.field]: { edited: e.target.value } });
                }}
              />
            </>
          ) : (
            <Hint>
              {row.values.map((value) => value ?? '—').join('  ·  ')} — describes the row, not the
              person; the survivor keeps its own.
            </Hint>
          )}
        </div>
      ))}

      <TextAreaField
        label="Why"
        hint="Recorded on both records, with the value each field took and where it came from."
        rows={3}
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
        }}
        required
      />
      {failure !== null && <ErrorText>{failure}</ErrorText>}
      <Hint>
        Merging repoints every legacy id, recomputes the consent state and records which record
        supplied which field. It can be undone through the API; there is no screen for that.
      </Hint>
      <ButtonRow>
        <Button
          variant="primary"
          busy={busy === 'merge'}
          disabled={!ready}
          onClick={() => {
            void send({ action: 'merge', survivorId, loserId, decisions: decisions() }, 'merge');
          }}
        >
          Merge
        </Button>
        <Button
          variant="danger"
          busy={busy === 'apart'}
          disabled={!ready}
          onClick={() => {
            void send({ action: 'not_the_same_person' }, 'apart');
          }}
        >
          Not the same person
        </Button>
        <Button
          disabled={busy !== null}
          onClick={() => {
            router.push('/console');
          }}
        >
          Leave open
        </Button>
      </ButtonRow>
      {Object.keys(picks).length > 0 && (
        <Caption>{`${String(Object.keys(picks).length)} of ${String(rows.length)} fields decided by hand; the rest follow the rule above.`}</Caption>
      )}
    </Card>
  );
}
