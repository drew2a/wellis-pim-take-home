'use client';

// `'use client'` for the same reason `./Field.tsx` carries it: every caller is already a client
// component, and saying so here stops a future server-rendered button from failing at runtime.
import type { ReactElement, ReactNode } from 'react';

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
  'A decision is only recorded with the reason you give it — write one in the field below first.';

/**
 * The one place a screen's actions live, so they are never scattered down the page. The console's
 * decisions have their own bar (`./DecisionBar.tsx`); this is the intake flow and the login form,
 * where a row of buttons ends a page rather than hanging off the bottom of it.
 */
export function ButtonRow({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <div className="mt-8">
      <div className="flex gap-3">{children}</div>
    </div>
  );
}
