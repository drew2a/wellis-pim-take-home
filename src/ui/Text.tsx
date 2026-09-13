import type { ReactElement, ReactNode } from 'react';

/** The sentence under a page title that says what this screen is for. */
export function Lead({ children }: { children: ReactNode }): ReactElement {
  return <p className="mb-6 text-grey-600">{children}</p>;
}

export function Hint({ children }: { children: ReactNode }): ReactElement {
  return <p className="text-sm text-grey-500">{children}</p>;
}

/** A message the page could not attribute to one field — shown, never swallowed. */
export function ErrorText({ children }: { children: ReactNode }): ReactElement {
  return <p className="mt-3 text-sm text-bad-700">{children}</p>;
}

/**
 * Text authored elsewhere and shown verbatim — the consent statement, for instance.
 *
 * Its paragraphs are its blank lines; the single newlines inside a paragraph are where the source
 * file wraps, not where the author meant to break, so they are not reproduced. The words are
 * untouched either way: this decides where lines end, never what they say.
 */
export function Prose({ text }: { text: string }): ReactElement {
  return (
    <div className="mb-4 space-y-3 border-l-2 border-accent-200 bg-accent-50 px-4 py-3 text-grey-800">
      {text.split(/\n\s*\n/).map((paragraph) => (
        <p key={paragraph}>{paragraph.trim().replace(/\s*\n\s*/g, ' ')}</p>
      ))}
    </div>
  );
}

/** The engine's explanation lines, or any other list of short findings. */
export function Findings({ items }: { items: readonly string[] }): ReactElement {
  return (
    <ul className="my-4 space-y-1.5">
      {items.map((item) => (
        <li key={item} className="border-l-2 border-grey-200 pl-3 text-grey-800">
          {item}
        </li>
      ))}
    </ul>
  );
}
