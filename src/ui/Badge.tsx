import type { ReactElement, ReactNode } from 'react';

import { TONE_CLASSES, humanise, toneForState, type Tone } from './tones';

/** A state or a kind, said in one word and one colour. */
export function Badge({ tone, children }: { tone: Tone; children: ReactNode }): ReactElement {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-sm font-medium ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * An intake state, coloured by `STATE_TONES`. Takes a `string` rather than `IntakeState` because
 * its caller is usually holding a state that came off the network, and the client is defensive
 * about the network (`CLAUDE.md` §2); an unrecognised state shows grey rather than disappearing.
 */
export function StateBadge({ state }: { state: string }): ReactElement {
  return <Badge tone={toneForState(state)}>{humanise(state)}</Badge>;
}
