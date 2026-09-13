import type { ReactElement, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

const BASE =
  'inline-flex items-center justify-center rounded-md border px-4 py-2 font-medium ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 ' +
  'disabled:cursor-not-allowed disabled:opacity-55 aria-busy:cursor-progress';

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

/** The one place a screen's actions live, so they are never scattered down the page. */
export function ButtonRow({ children }: { children: ReactNode }): ReactElement {
  return <div className="mt-8 flex gap-3">{children}</div>;
}
