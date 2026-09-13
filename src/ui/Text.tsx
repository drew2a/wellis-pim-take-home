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
 * Text authored elsewhere and shown exactly as authored — the consent statement, for instance.
 *
 * It reproduces the author's line breaks rather than deciding where lines end. A blank line starts
 * a new paragraph; every other break is kept as a break, so a list or a deliberate hard break in a
 * consent statement reaches the patient the way it was written. The rule is `CLAUDE.md` §5: the
 * text a patient agrees to and the text we store are the same text, whitespace included, and a
 * renderer is not the place to decide otherwise. Source files that feed this must therefore wrap
 * their paragraphs at the author's breaks, not at the editor's margin.
 */
export function Prose({ text }: { text: string }): ReactElement {
  return (
    <div className="mb-4 space-y-3 border-l-2 border-accent-200 bg-accent-50 px-4 py-3 whitespace-pre-line text-grey-800">
      {text.split(/\n[ \t]*\n/).map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </div>
  );
}
