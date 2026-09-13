'use client';

// Signing in (ADR-0021). Two fields, because there are two facts: which of the seeded reviewers
// you are, and whether you have the console's secret. The first is identification and is a list;
// the second is the lock.
//
// The form carries no rules — it posts, and the server decides. The message it shows on a refusal
// is the server's own, and it is deliberately the same whether the secret was wrong or the
// reviewer unknown, so this page cannot be used to list the care team.
import { useRouter } from 'next/navigation';
import { useState, type ReactElement } from 'react';

import { Button, ButtonRow, Card, Choice, ErrorText, Field, Hint, TextField } from '@/ui';

export interface SeededReviewer {
  readonly id: string;
  readonly name: string;
}

export function LoginForm({
  reviewers,
}: {
  readonly reviewers: readonly SeededReviewer[];
}): ReactElement {
  const router = useRouter();
  const [reviewerId, setReviewerId] = useState(reviewers[0]?.id ?? '');
  const [secret, setSecret] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signIn = async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      const response = await fetch('/api/console/session', {
        method: 'POST',
        body: JSON.stringify({ reviewerId, secret }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setFailure(body.error ?? 'that did not work');
        return;
      }
      // `refresh` as well as `push`: the console's pages are server-rendered and read the session.
      router.push('/console');
      router.refresh();
    } catch {
      setFailure('the console could not be reached');
    } finally {
      setBusy(false);
    }
  };

  if (reviewers.length === 0) {
    return (
      <Card>
        <ErrorText>
          No reviewer is seeded. Set REVIEWERS in the environment and run `npm run seed:reviewers`.
        </ErrorText>
      </Card>
    );
  }

  return (
    <Card>
      <Field label="Who are you?" hint="The care team, as seeded for this deployment.">
        {reviewers.map((reviewer) => (
          <Choice
            key={reviewer.id}
            type="radio"
            name="reviewerId"
            checked={reviewerId === reviewer.id}
            onChange={() => {
              setReviewerId(reviewer.id);
            }}
          >
            {reviewer.name}
          </Choice>
        ))}
      </Field>
      <TextField
        label="Console secret"
        type="password"
        autoComplete="current-password"
        value={secret}
        onChange={(e) => {
          setSecret(e.target.value);
        }}
        required
      />
      <Hint>
        One secret for the whole team: it locks the console, it does not tell us apart. A real
        deployment plugs SSO in here.
      </Hint>
      {failure !== null && <ErrorText>{failure}</ErrorText>}
      <ButtonRow>
        <Button
          variant="primary"
          busy={busy}
          disabled={secret === ''}
          onClick={() => {
            void signIn();
          }}
        >
          Sign in
        </Button>
      </ButtonRow>
    </Card>
  );
}
