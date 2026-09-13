'use client';

// The decision, pinned to the bottom of the detail pane (ADR-0028 §2).
//
// Every decision in this console records the reviewer's own words (R-C6). Until this design each
// of the seven decision components asked for them with its own textarea in its own card; they all
// ask here now, in one line, next to the buttons the words are recorded against. What a decision
// additionally *needs* — the fields of a merge, the rows of a vocabulary item, a patient search, a
// typed value — stays in the body above, because that is evidence being chosen rather than the
// decision being written.
import { useEffect, useId, type ReactElement, type ReactNode } from 'react';

export type DecisionVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/** The key that also takes the first action: Enter, including from inside the reason field. */
export const ENTER = '↵';

export interface DecisionAction {
  readonly label: ReactNode;
  readonly variant?: DecisionVariant;
  /**
   * The key that takes this action — `ENTER`, or a single uppercase letter. It is a shortcut for
   * someone working a long queue and never the only way in: the button is the control. A letter
   * is ignored while the reviewer is typing, and every shortcut obeys `disabled`, so a key cannot
   * take a move the button will not.
   */
  readonly hint?: string;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly onPick: () => void;
}

const BUTTON =
  'inline-flex shrink-0 items-center gap-[7px] rounded-[7px] border px-[11px] py-2 text-[13px] leading-[17px] font-semibold whitespace-nowrap ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 ' +
  'disabled:cursor-not-allowed disabled:border-grey-200 disabled:bg-hairline disabled:text-grey-400 ' +
  'aria-busy:cursor-progress';

// Disabled is grey, not a faded version of the variant's own colour: a washed-out primary button
// still reads as the thing to press, and here that button is often the one the machine refuses.
const VARIANTS: Readonly<Record<DecisionVariant, string>> = {
  primary: 'border-accent-600 bg-accent-600 text-white not-disabled:hover:bg-accent-700',
  secondary: 'border-grey-300 bg-white text-grey-800 not-disabled:hover:bg-grey-50',
  ghost: 'border-grey-100 bg-transparent text-grey-700 not-disabled:hover:bg-white',
  danger: 'border-bad-700 bg-white text-bad-700 not-disabled:hover:bg-bad-50',
};

const typing = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement;

/**
 * The bar: the reason, and the actions it is recorded against.
 *
 * `unavailable` is what a disabled row owes the reader. A `disabled` button stops the click and
 * says nothing — a reviewer facing two grey buttons has to guess what is missing — so a row that
 * can be unavailable says why, above the buttons and bound to them for a screen reader
 * (ADR-0026).
 */
export function DecisionBar({
  note,
  onNote,
  placeholder,
  unavailable,
  error,
  actions,
}: {
  /**
   * The three go together, and all three are omitted where the move records no words of the
   * reviewer's own — claiming an intake writes "claimed for review" and the route's schema is
   * strict, so a field here would be a box whose contents are thrown away.
   */
  readonly note?: string;
  readonly onNote?: (value: string) => void;
  readonly placeholder?: string;
  readonly unavailable?: string | undefined;
  /** What the server said when it refused — shown, never swallowed. */
  readonly error?: string | null;
  readonly actions: readonly DecisionAction[];
}): ReactElement {
  const id = useId();

  // Re-bound on every render rather than read through a ref: `actions` carries the `disabled` and
  // `busy` of this render, and a shortcut must refuse exactly what its button refuses.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const wanted =
        event.key === 'Enter' ? ENTER : typing(event.target) ? null : event.key.toUpperCase();
      if (wanted === null) return;
      const action = actions.find((each) => each.hint === wanted);
      if (action === undefined || action.disabled === true || action.busy === true) return;
      event.preventDefault();
      action.onPick();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [actions]);

  const said = unavailable !== undefined;
  const failed = error !== null && error !== undefined;

  return (
    <footer className="flex-none border-t border-grey-200 bg-white px-5 py-2.5 shadow-[0_-6px_18px_rgb(16_24_26/0.04)]">
      {(said || failed) && (
        <div className="pb-2">
          {said && (
            <p id={`${id}-why`} className="text-xs text-grey-500">
              {unavailable}
            </p>
          )}
          {failed && <p className="text-xs text-bad-700">{error}</p>}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-end gap-x-2.5 gap-y-2">
        {note !== undefined && onNote !== undefined && (
          <>
            <label
              htmlFor={`${id}-note`}
              className="flex-none font-mono text-[10px] tracking-[0.12em] text-grey-600 uppercase"
              title="Recorded with your name"
            >
              Reason
            </label>
            <input
              id={`${id}-note`}
              type="text"
              value={note}
              onChange={(event) => {
                onNote(event.target.value);
              }}
              placeholder={placeholder}
              aria-label="Your reason, recorded with your name"
              aria-describedby={said ? `${id}-why` : undefined}
              className="min-w-0 flex-1 basis-48 rounded-[7px] border border-grey-200 bg-grey-50 px-[11px] py-2 text-[13px] text-grey-900 placeholder:text-grey-400 focus:border-accent-600 focus:bg-white focus:outline-none"
            />
          </>
        )}
        {actions.map((action, index) => (
          <button
            key={index}
            type="button"
            className={`${BUTTON} ${VARIANTS[action.variant ?? 'secondary']}`}
            disabled={action.disabled === true || action.busy === true}
            aria-busy={action.busy === true}
            aria-describedby={said ? `${id}-why` : undefined}
            onClick={action.onPick}
          >
            <span>{action.label}</span>
            {action.hint !== undefined && (
              <span aria-hidden="true" className="font-mono text-[11px] opacity-60">
                {action.hint}
              </span>
            )}
          </button>
        ))}
      </div>
    </footer>
  );
}
