import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from 'react';

/**
 * One question: its label, its hint, the control, and the server's message about the answer.
 *
 * A `fieldset` with a `legend` rather than a `label`, because a question here is as often a group
 * of radios or checkboxes as it is a single input, and a `legend` names all of them for a screen
 * reader without anything having to thread an id through to the control.
 */
export function Field({
  label,
  hint,
  message,
  children,
}: {
  readonly label: string;
  readonly hint?: string | undefined;
  /** The server's own message about this field, shown verbatim. */
  readonly message?: string | undefined;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <fieldset className="mb-6 last:mb-0">
      {label !== '' && <legend className="mb-1 font-medium text-grey-900">{label}</legend>}
      {hint !== undefined && <p className="mb-2 text-sm text-grey-500">{hint}</p>}
      {children}
      {message !== undefined && <p className="mt-1.5 text-sm text-bad-700">{message}</p>}
    </fieldset>
  );
}

const CONTROL =
  'block w-full max-w-sm rounded-md border border-grey-300 bg-white px-3 py-2 text-grey-900 ' +
  'placeholder:text-grey-400 focus-visible:border-accent-600 focus-visible:outline-2 ' +
  'focus-visible:outline-offset-1 focus-visible:outline-accent-600';

export function TextInput(
  props: Omit<ComponentPropsWithoutRef<'input'>, 'className'>,
): ReactElement {
  return <input className={CONTROL} {...props} />;
}

export function TextArea(
  props: Omit<ComponentPropsWithoutRef<'textarea'>, 'className'>,
): ReactElement {
  return <textarea className={CONTROL} {...props} />;
}

/** One radio or checkbox with its text, sized so the whole row is a comfortable click target. */
export function Choice({
  children,
  ...props
}: Omit<ComponentPropsWithoutRef<'input'>, 'className'>): ReactElement {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 py-1 text-grey-800">
      <input
        className="size-4 accent-accent-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600"
        {...props}
      />
      {children}
    </label>
  );
}
