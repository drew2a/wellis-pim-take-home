import type { ReactElement } from 'react';

/**
 * Where the patient is in a multi-step form: the count, the title of this step, and one static
 * segment per step so the remaining work is visible without reading. No animation — the bar is a
 * fact about the current render, not a transition.
 */
export function StepIndicator({
  index,
  count,
  title,
}: {
  /** Zero-based. */
  readonly index: number;
  readonly count: number;
  readonly title: string;
}): ReactElement {
  return (
    <div className="mb-5">
      <div className="mb-2 flex gap-1.5" aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <span
            key={i}
            className={
              i <= index
                ? 'h-1 flex-1 rounded-full bg-accent-600'
                : 'h-1 flex-1 rounded-full bg-grey-200'
            }
          />
        ))}
      </div>
      <p className="text-sm font-medium text-grey-500">
        Step {index + 1} of {count}
      </p>
      <h2 className="text-xl font-semibold tracking-tight text-grey-900">{title}</h2>
    </div>
  );
}
