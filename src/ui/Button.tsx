'use client';

// `'use client'` for the same reason `./Field.tsx` carries it: `ButtonRow` names its reason with
// `useId`, and a hook cannot run in a server component. Every caller is already a client
// component; saying so here stops a future server-rendered button from failing at runtime.
import { useId, type ReactElement, type ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

// Disabled is grey, not a faded version of the variant's own colour: a washed-out primary button
// still reads as the thing to press, and the one place this matters is a consent screen where the
// button must not invite the click until the patient has agreed.
const BASE =
  'inline-flex items-center justify-center rounded-md border px-4 py-2 font-medium ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 ' +
  'disabled:cursor-not-allowed disabled:border-grey-200 disabled:bg-grey-100 ' +
  'disabled:text-grey-500 aria-busy:cursor-progress';

const VARIANTS: Readonly<Record<ButtonVariant, string>> = {
  primary: 'border-accent-600 bg-accent-600 text-white not-disabled:hover:bg-accent-700',
  secondary: 'border-grey-300 bg-white text-grey-800 not-disabled:hover:bg-grey-100',
  danger: 'border-bad-700 bg-white text-bad-700 not-disabled:hover:bg-bad-50',
};

/**
 * `busy` is the disabled state that means "your click landed, the server has it" — distinct from
 * `disabled`, which means "not now". Both stop the click; only `busy` says why.
 */
export function Button({
  variant = 'secondary',
  type = 'button',
  busy = false,
  disabled = false,
  onClick,
  children,
}: {
  readonly variant?: ButtonVariant;
  readonly type?: 'button' | 'submit';
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly onClick?: () => void;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <button
      type={type}
      className={`${BASE} ${VARIANTS[variant]}`}
      disabled={disabled || busy}
      aria-busy={busy}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * Why a row of actions is unavailable, when it is. Every decision in the console records the
 * reviewer's own words (R-C6), so an empty note is what usually holds the row, and this is that
 * sentence in one place rather than seven.
 */
export const NEEDS_A_NOTE =
  'Write why above first: a decision is only recorded with the reason you give it.';

/**
 * The one place a screen's actions live, so they are never scattered down the page.
 *
 * `reason` is what a disabled row owes the reader. `Button`'s own `disabled` stops the click and
 * says nothing — a reviewer facing two grey buttons has to guess which field is missing — so a row
 * that can be unavailable says why, above the buttons and bound to them for a screen reader.
 */
export function ButtonRow({
  reason,
  children,
}: {
  readonly reason?: string | undefined;
  readonly children: ReactNode;
}): ReactElement {
  const id = useId();
  return (
    <div className="mt-8">
      {reason !== undefined && (
        <p id={id} className="mb-2 text-sm text-grey-500">
          {reason}
        </p>
      )}
      <div className="flex gap-3" aria-describedby={reason === undefined ? undefined : id}>
        {children}
      </div>
    </div>
  );
}
