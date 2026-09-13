'use client';

// The one piece of plumbing every decision in the console shares: the reviewer's reason, what the
// server said if it refused, which button is in flight, and where to go afterwards.
//
// It was copied into seven components before this design, which meant seven copies of "swallow
// nothing, show what the server said". It is one copy now. What it does **not** hold is any
// business rule: it posts what was chosen and the server decides what follows (R-T4).
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface Decide {
  readonly note: string;
  readonly setNote: (value: string) => void;
  /** A decision is only recorded with the reason it was given (R-C6). */
  readonly noted: boolean;
  readonly failure: string | null;
  readonly busy: string | null;
  /**
   * Post one decision. `label` is what the caller calls this button, so it can show that one
   * busy; `stay` keeps the reviewer on this screen — a claim leaves the intake open in front of
   * them — where the default moves on to the next row of the queue.
   */
  readonly send: (label: string, body: Record<string, unknown>, stay?: boolean) => void;
}

export function useDecide(url: string, after: string): Decide {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const post = async (
    label: string,
    body: Record<string, unknown>,
    stay: boolean,
  ): Promise<void> => {
    setBusy(label);
    setFailure(null);
    try {
      const response = await fetch(url, { method: 'POST', body: JSON.stringify(body) });
      if (!response.ok) {
        const answer = (await response.json()) as { error?: string };
        setFailure(answer.error ?? 'that did not work');
        return;
      }
      if (!stay) router.push(after);
      router.refresh();
    } catch {
      setFailure('the console could not be reached');
    } finally {
      setBusy(null);
    }
  };

  return {
    note,
    setNote,
    noted: note.trim() !== '',
    failure,
    busy,
    send: (label, body, stay = false) => {
      void post(label, body, stay);
    },
  };
}
