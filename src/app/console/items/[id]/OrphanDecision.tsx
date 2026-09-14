'use client';

// Attaching an orphan intake, or leaving it unresolved (ADR-0006). The only way to an identity is
// the reviewer's own search — no candidate patients are offered, because the intake carries no
// name, no date of birth and no email, and build is not a weaker identity signal but none at all
// (ADR-0029).
//
// For the same reason there is no "create a patient" button, here or anywhere: a row with none of
// those fields is a fabricated record.
import { useState, type ReactElement, type ReactNode } from 'react';

import { useDecide } from '@/app/console/useDecide';
import {
  Button,
  Choice,
  DecisionBar,
  DetailBody,
  DetailSection,
  ENTER,
  ErrorText,
  Hint,
  NEEDS_A_NOTE,
  TextField,
} from '@/ui';

interface Match {
  readonly id: string;
  readonly fullName: string;
  readonly dob: string | null;
  readonly email: string | null;
  readonly city: string | null;
}

export function OrphanDecision({
  itemId,
  after,
  children,
}: {
  readonly itemId: string;
  readonly after: string;
  readonly children: ReactNode;
}): ReactElement {
  const decide = useDecide(`/api/console/items/${itemId}/resolve`, after);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<readonly Match[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState<string | null>(null);
  const [patientId, setPatientId] = useState('');

  const search = async (): Promise<void> => {
    setSearching(true);
    setSearchFailed(null);
    try {
      const response = await fetch(`/api/console/patients/search?q=${encodeURIComponent(query)}`);
      const body = (await response.json()) as { patients?: Match[]; error?: string };
      if (!response.ok) {
        setSearchFailed(body.error ?? 'that search did not work');
        return;
      }
      setMatches(body.patients ?? []);
      setSearched(true);
    } catch {
      setSearchFailed('the console could not be reached');
    } finally {
      setSearching(false);
    }
  };

  const stopped = !decide.noted || decide.busy !== null;

  return (
    <>
      <DetailBody>
        {children}
        <DetailSection title="Attach to a patient">
          <Hint>
            A search, not a suggestion: this console will not guess an identity from body
            measurements.
          </Hint>
          <TextField
            label="Find the patient"
            hint="Part of a name or an email address, or a legacy id in full."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
          />
          <Button
            busy={searching}
            disabled={query.trim().length < 2 || searching}
            onClick={() => {
              void search();
            }}
          >
            Search
          </Button>
          {searchFailed !== null && <ErrorText>{searchFailed}</ErrorText>}
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
        </DetailSection>
      </DetailBody>
      <DecisionBar
        note={decide.note}
        onNote={decide.setNote}
        placeholder="e.g. confirmed by phone with the patient"
        unavailable={
          !decide.noted
            ? NEEDS_A_NOTE
            : patientId === ''
              ? 'Search for the patient above, or leave the intake unattached — an unresolved orphan is an acceptable outcome, and the import report counts them.'
              : undefined
        }
        error={decide.failure}
        actions={[
          {
            label: 'Attach to this patient',
            variant: 'primary',
            hint: ENTER,
            busy: decide.busy === 'attach',
            disabled: stopped || patientId === '',
            onPick: () => {
              decide.send('attach', { action: 'attach', patientId, note: decide.note });
            },
          },
          {
            label: 'Leave unresolved',
            hint: 'D',
            busy: decide.busy === 'leave',
            disabled: stopped,
            onPick: () => {
              decide.send('leave', { action: 'leave_unresolved', note: decide.note });
            },
          },
        ]}
      />
    </>
  );
}
