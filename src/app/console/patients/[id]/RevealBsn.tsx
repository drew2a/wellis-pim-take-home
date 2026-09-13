'use client';

// The number the console masks everywhere. Asking for it writes an audit entry before it answers,
// so "who has looked at this" is a question the record can answer (ADR-0023 item 8).
import { useState, type ReactElement } from 'react';

import { Button, Caption, ErrorText, Raw } from '@/ui';

export function RevealBsn({
  patientId,
  masked,
}: {
  readonly patientId: string;
  readonly masked: string;
}): ReactElement {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (revealed !== null) {
    return (
      <span>
        <Raw>{revealed}</Raw> <Caption>this look is on the record</Caption>
      </span>
    );
  }

  return (
    <span>
      <Raw>{masked}</Raw>{' '}
      <Button
        busy={busy}
        onClick={() => {
          setBusy(true);
          setFailure(null);
          void fetch(`/api/console/patients/${patientId}/bsn`, { method: 'POST' })
            .then(async (response) => {
              const body = (await response.json()) as { bsn?: string | null; error?: string };
              if (!response.ok) {
                setFailure(body.error ?? 'that did not work');
                return;
              }
              setRevealed(body.bsn ?? 'none');
            })
            .catch(() => {
              setFailure('the console could not be reached');
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        Reveal
      </Button>
      {failure !== null && <ErrorText>{failure}</ErrorText>}
    </span>
  );
}
