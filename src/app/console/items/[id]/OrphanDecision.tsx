'use client';

// Attaching an orphan intake, or leaving it unresolved (ADR-0006). The look-alikes the importer
// found are shown as **context, not a proposal** — even a single one is a guess, which is why the
// importer attached nothing — and the reviewer may search for any other patient instead.
//
// There is no "create a patient" button, here or anywhere: the intake carries no name, no date of
// birth and no email, and a row with none of those is a fabricated record.
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
  NEEDS_A_NOTE,
  TextAreaField,
  TextField,
} from '@/ui';

interface Match {
  readonly id: string;
  readonly fullName: string;
  readonly dob: string | null;
  readonly email: string | null;
  readonly city: string | null;
}

export function OrphanDecision({ itemId }: { readonly itemId: string }): ReactElement {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<readonly Match[]>([]);
  const [searched, setSearched] = useState(false);
  const [patientId, setPatientId] = useState('');
  const [note, setNote] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const search = async (): Promise<void> => {
    setBusy('search');
    setFailure(null);
    try {
      const response = await fetch(`/api/console/patients/search?q=${encodeURIComponent(query)}`);
      const body = (await response.json()) as { patients?: Match[]; error?: string };
      if (!response.ok) {
        setFailure(body.error ?? 'that search did not work');
        return;
      }
      setMatches(body.patients ?? []);
      setSearched(true);
    } catch {
      setFailure('the console could not be reached');
    } finally {
      setBusy(null);
    }
  };

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
      <TextField
        label="Find the patient"
        hint="Part of a name or an email address, or a legacy id in full."
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
        }}
      />
      <ButtonRow
        reason={query.trim().length < 2 ? 'Type at least two characters to search.' : undefined}
      >
        <Button
          busy={busy === 'search'}
          disabled={query.trim().length < 2 || busy !== null}
          onClick={() => {
            void search();
          }}
        >
          Search
        </Button>
      </ButtonRow>

      {searched && matches.length === 0 && <Hint>Nobody matches that.</Hint>}
      {matches.map((match) => (
        <Choice
          key={match.id}
          type="radio"
          name="patientId"
          checked={patientId === match.id}
          onChange={() => {
            setPatientId(match.id);
          }}
        >
          {`${match.fullName} — born ${match.dob ?? 'unknown'}, ${match.email ?? 'no email'}, ${match.city ?? 'no city'}`}
        </Choice>
      ))}

      <TextAreaField
        label="Why"
        hint="What makes this the right patient — or why the intake stays unattached."
        rows={3}
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
        }}
        required
      />
      {failure !== null && <ErrorText>{failure}</ErrorText>}
      <Caption>
        An unresolved orphan is an acceptable outcome. The import report counts them.
      </Caption>
      <ButtonRow reason={noted ? undefined : NEEDS_A_NOTE}>
        <Button
          variant="primary"
          busy={busy === 'attach'}
          disabled={!noted || patientId === '' || busy !== null}
          onClick={() => {
            void send({ action: 'attach', patientId }, 'attach');
          }}
        >
          Attach to this patient
        </Button>
        <Button
          busy={busy === 'leave'}
          disabled={!noted || busy !== null}
          onClick={() => {
            void send({ action: 'leave_unresolved' }, 'leave');
          }}
        >
          Leave unresolved
        </Button>
      </ButtonRow>
    </Card>
  );
}
