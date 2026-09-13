'use client';

import { useId, type ComponentPropsWithoutRef, type ReactElement, type ReactNode } from 'react';

/**
 * A group of related controls — radios, checkboxes — under one question.
 *
 * A `fieldset` with a `legend`, because a `legend` names all of the controls at once for a screen
 * reader and no id has to be threaded to any of them. The hint and the server's message are named
 * on the `fieldset` itself, so they are read with the group rather than sitting loose beside it.
 *
 * A single text control is a different shape and uses `TextField` / `TextAreaField` below: there,
 * the correct markup is a `label` bound to that one control, not a group of one.
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
  const id = useId();
  const { hintId, messageId, describedBy } = describe(id, hint, message);
  return (
    <fieldset className="mb-6 last:mb-0" aria-describedby={describedBy}>
      {label !== '' && <legend className="mb-1 font-medium text-grey-900">{label}</legend>}
      {hint !== undefined && <Hint id={hintId}>{hint}</Hint>}
      {children}
      {message !== undefined && <Message id={messageId}>{message}</Message>}
    </fieldset>
  );
}

/** One text input under its own label, with the hint and the message bound to it. */
export function TextField({
  label,
  hint,
  message,
  ...props
}: Labelled & Omit<ComponentPropsWithoutRef<'input'>, 'className' | 'id'>): ReactElement {
  const id = useId();
  const { hintId, messageId, describedBy } = describe(id, hint, message);
  return (
    <Labelling
      id={id}
      label={label}
      hint={hint}
      hintId={hintId}
      message={message}
      messageId={messageId}
    >
      <input
        id={id}
        className={CONTROL}
        aria-describedby={describedBy}
        aria-invalid={message !== undefined}
        {...props}
      />
    </Labelling>
  );
}

/** As `TextField`, for the answers that are a few sentences rather than a few words. */
export function TextAreaField({
  label,
  hint,
  message,
  ...props
}: Labelled & Omit<ComponentPropsWithoutRef<'textarea'>, 'className' | 'id'>): ReactElement {
  const id = useId();
  const { hintId, messageId, describedBy } = describe(id, hint, message);
  return (
    <Labelling
      id={id}
      label={label}
      hint={hint}
      hintId={hintId}
      message={message}
      messageId={messageId}
    >
      <textarea
        id={id}
        className={CONTROL}
        aria-describedby={describedBy}
        aria-invalid={message !== undefined}
        {...props}
      />
    </Labelling>
  );
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

interface Labelled {
  readonly label: string;
  readonly hint?: string | undefined;
  /** The server's own message about this field, shown verbatim. */
  readonly message?: string | undefined;
}

const CONTROL =
  'block w-full max-w-sm rounded-md border border-grey-300 bg-white px-3 py-2 text-grey-900 ' +
  'placeholder:text-grey-400 focus-visible:border-accent-600 focus-visible:outline-2 ' +
  'focus-visible:outline-offset-1 focus-visible:outline-accent-600';

/** The ids a control is named and described by. Absent text gets no id and no reference. */
function describe(
  id: string,
  hint: string | undefined,
  message: string | undefined,
): { hintId: string; messageId: string; describedBy: string | undefined } {
  const hintId = `${id}-hint`;
  const messageId = `${id}-message`;
  const referenced = [hint !== undefined ? hintId : '', message !== undefined ? messageId : '']
    .filter((each) => each !== '')
    .join(' ');
  return { hintId, messageId, describedBy: referenced === '' ? undefined : referenced };
}

/** The label, hint, control and message of one text field, in that order. */
function Labelling({
  id,
  label,
  hint,
  hintId,
  message,
  messageId,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly hint: string | undefined;
  readonly hintId: string;
  readonly message: string | undefined;
  readonly messageId: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className="mb-6 last:mb-0">
      <label htmlFor={id} className="mb-1 block font-medium text-grey-900">
        {label}
      </label>
      {hint !== undefined && <Hint id={hintId}>{hint}</Hint>}
      {children}
      {message !== undefined && <Message id={messageId}>{message}</Message>}
    </div>
  );
}

function Hint({ id, children }: { readonly id: string; readonly children: string }): ReactElement {
  return (
    <p id={id} className="mb-2 text-sm text-grey-500">
      {children}
    </p>
  );
}

function Message({
  id,
  children,
}: {
  readonly id: string;
  readonly children: string;
}): ReactElement {
  return (
    <p id={id} className="mt-1.5 text-sm text-bad-700">
      {children}
    </p>
  );
}
