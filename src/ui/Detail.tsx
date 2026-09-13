import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';

import { Dot } from './Rail';
import { TONE_CLASSES, type Tone } from './tones';

// The console's right pane (ADR-0028): one piece of work, its evidence, and the decision it asks
// for. Everything here is presentational — what the evidence *is* is decided by the page.

/**
 * The three panes. It scrolls sideways rather than reflowing below ~840px: the console is a
 * desk-width screen, and a queue that stacks under its own detail pane is not the same tool.
 */
export function ConsoleFrame({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <div className="h-screen overflow-x-auto overflow-y-hidden bg-grey-50">
      <div className="grid h-screen min-w-[840px] grid-cols-[minmax(168px,216px)_minmax(260px,332px)_minmax(360px,1fr)] grid-rows-[minmax(0,1fr)] text-sm">
        {children}
      </div>
    </div>
  );
}

export function DetailPane({ children }: { readonly children: ReactNode }): ReactElement {
  return <section className="flex min-h-0 min-w-0 flex-col bg-grey-50">{children}</section>;
}

const STEP =
  'flex h-[26px] w-[26px] items-center justify-center rounded-md border border-grey-200 text-[13px] no-underline';

/** ↑ and ↓ through the queue, next to where it says which of how many this is. */
function Step({
  href,
  label,
  glyph,
}: {
  readonly href: string | null;
  readonly label: string;
  readonly glyph: string;
}): ReactElement {
  if (href === null) {
    return (
      <span aria-hidden="true" className={`${STEP} bg-grey-50 text-grey-400`}>
        {glyph}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={label}
      className={`${STEP} bg-white text-grey-700 hover:bg-grey-50`}
    >
      {glyph}
    </Link>
  );
}

function Divider(): ReactElement {
  return <span aria-hidden="true" className="block h-3 w-px bg-grey-200" />;
}

/**
 * What this is, in the vocabulary the rest of the system uses: the kind, the rule that raised it,
 * the day it was raised — and where it sits in the queue behind it.
 */
export function DetailHeader({
  tone,
  kindLabel,
  rule,
  raised,
  position,
  prevHref = null,
  nextHref = null,
  title,
  patient,
  patientMeta,
}: {
  readonly tone: Tone;
  readonly kindLabel: string;
  readonly rule: string;
  readonly raised: string;
  /** "3 of 13", or null where the detail was not reached from a queue. */
  readonly position: string | null;
  readonly prevHref?: string | null;
  readonly nextHref?: string | null;
  readonly title: string;
  readonly patient: ReactNode;
  readonly patientMeta: ReactNode;
}): ReactElement {
  return (
    <header className="flex flex-col gap-[7px] border-b border-grey-200 bg-white px-5 pt-[13px] pb-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <Dot tone={tone} size={8} />
        <span className="font-mono text-[10.5px] tracking-[0.12em] text-grey-600 uppercase">
          {kindLabel}
        </span>
        <Divider />
        <span className="font-mono text-[11.5px] text-grey-600">{rule}</span>
        <Divider />
        <span className="font-mono text-[11.5px] text-grey-600">raised {raised}</span>
        {position !== null && (
          <span className="ml-auto flex items-center gap-2.5">
            <span className="font-mono text-[11.5px] text-grey-500">{position}</span>
            <Step href={prevHref} label="Previous in the queue" glyph="↑" />
            <Step href={nextHref} label="Next in the queue" glyph="↓" />
          </span>
        )}
      </div>
      <h1 className="max-w-[52ch] text-[19px] leading-[25px] font-semibold tracking-tight text-pretty text-grey-900">
        {title}
      </h1>
      <div className="flex flex-wrap items-baseline gap-2.5">
        <span className="text-[13.5px] font-medium">{patient}</span>
        <span className="text-[12.5px] text-grey-500">{patientMeta}</span>
      </div>
    </header>
  );
}

/**
 * Everything between the header and the decision bar. It is the only thing on the page that
 * scrolls.
 *
 * `[&>*]:shrink-0` is not decoration: this is a column flex container that scrolls, so a child
 * whose own `min-height` resolves to zero — which `overflow-hidden` on the comparison card does —
 * is squashed to a sliver instead of scrolling. Set here rather than on each card, because it is a
 * property of this container and every card is one of its children.
 */
export function DetailBody({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <div className="flex min-h-0 max-w-[920px] flex-1 flex-col gap-3.5 overflow-y-auto px-5 pt-4 pb-8 [&>*]:shrink-0">
      {children}
    </div>
  );
}

/** The one sentence a reviewer needs before the evidence — what is actually open, or what is not. */
export function Banner({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <p className="rounded-r-[7px] border-l-2 border-accent-400 bg-accent-50 px-3.5 py-2.5 text-[13px] leading-[19px] text-pretty text-accent-800">
      {children}
    </p>
  );
}

function Panel({ children }: { readonly children: ReactNode }): ReactElement {
  return <div className="rounded-[10px] border border-grey-200 bg-white">{children}</div>;
}

function PanelHead({
  title,
  note,
}: {
  readonly title: string;
  readonly note?: ReactNode;
}): ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-grey-100 px-[18px] py-[13px]">
      <h2 className="font-mono text-xs tracking-[0.12em] text-grey-600 uppercase">{title}</h2>
      {note !== undefined && <span className="text-xs text-grey-500">{note}</span>}
    </div>
  );
}

/**
 * A value too long to sit in a row, folded behind its own size.
 *
 * One payload field can be a 69-element array, and a value like that fills the pane and hides the
 * five fields under it. Cutting it would hide evidence, which is the one thing this card exists to
 * show, and capping every row so it can scroll gives a one-word value a scrollbar — so the long
 * value, and only the long value, says how big it is and opens where it sits.
 */
export function Folded({
  summary,
  children,
}: {
  readonly summary: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <details className="group">
      <summary className="inline-flex cursor-pointer items-center gap-1.5 font-mono text-[12.5px] text-grey-600 marker:content-[''] hover:text-grey-900">
        <span aria-hidden="true" className="text-[9px] group-open:rotate-90">
          ▶
        </span>
        {summary}
      </summary>
      <div className="mt-1.5 max-h-72 overflow-y-auto pr-1">{children}</div>
    </details>
  );
}

export interface EvidenceRow {
  readonly key?: string;
  readonly term: string;
  readonly value: ReactNode;
}

/**
 * Facts about one thing, as the export gave them. A description list rather than a table, because
 * these are labelled values and not rows of the same shape; the term is mono because it is a field
 * name, and the value is not, because it may be a sentence.
 */
export function EvidenceCard({
  title = 'Evidence',
  note,
  rows,
}: {
  readonly title?: string;
  readonly note?: ReactNode;
  readonly rows: readonly EvidenceRow[];
}): ReactElement {
  return (
    <Panel>
      <PanelHead title={title} note={note} />
      <dl className="m-0 px-[18px] pt-1.5 pb-4">
        {rows.map((row, index) => (
          <div
            key={row.key ?? index}
            className="flex flex-wrap items-baseline gap-x-4 gap-y-px border-b border-hairline py-2 last:border-b-0"
          >
            {/* A term is a field name and can be longer than its column — `metrics.weightKg` fits,
                `medications.otherMedications` does not — so it wraps inside the column rather than
                running under the value beside it. */}
            <dt className="w-38 shrink-0 font-mono text-[11.5px] [overflow-wrap:anywhere] text-grey-600">
              {row.term}
            </dt>
            <dd className="m-0 min-w-0 flex-1 basis-50 text-[13.5px] leading-5 break-words text-grey-900">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

export interface CompareRow {
  readonly field: string;
  readonly values: readonly ReactNode[];
  /** Tinted, because these are the rows worth reading — not a verdict on them. */
  readonly differs: boolean;
}

/** Two competing versions of the truth, side by side (R-C4). */
export function CompareCard({
  title,
  columns,
  rows,
}: {
  readonly title: string;
  readonly columns: readonly ReactNode[];
  readonly rows: readonly CompareRow[];
}): ReactElement {
  return (
    <div className="overflow-hidden rounded-[10px] border border-grey-200 bg-white">
      <PanelHead title={title} />
      <div className="flex flex-wrap gap-x-3.5 gap-y-0.5 border-b border-grey-100 px-[18px] py-[9px]">
        <span className="w-30 shrink-0 font-mono text-[11px] tracking-[0.08em] text-grey-600 uppercase">
          field
        </span>
        {columns.map((column, index) => (
          <span
            key={index}
            className="min-w-0 flex-1 basis-38 text-[12.5px] font-semibold break-words text-grey-900"
          >
            {column}
          </span>
        ))}
      </div>
      {rows.map((row) => (
        <div
          key={row.field}
          className={`flex flex-wrap gap-x-3.5 gap-y-0.5 px-[18px] py-[9px] ${
            row.differs ? 'border-b border-differs-200 bg-differs-50' : 'border-b border-hairline'
          }`}
        >
          <span className="w-30 shrink-0 font-mono text-xs text-grey-600">{row.field}</span>
          {row.values.map((value, index) => (
            <span
              key={index}
              className="min-w-0 flex-1 basis-38 text-[13.5px] break-words text-grey-900"
            >
              {value}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

export interface MergeOption {
  readonly value: string;
  readonly checked: boolean;
  readonly onPick: () => void;
}

export interface MergeField {
  readonly field: string;
  /** One per record in the merge, survivor first. Empty where the two records agree. */
  readonly options: readonly MergeOption[];
  /** The value both records hold, where they hold the same one. */
  readonly agreed: string | null;
  readonly typed: string;
  readonly onType: (value: string) => void;
  /** What records in the group but not in this merge hold, if any. Shown, never pickable. */
  readonly aside: string | null;
}

/**
 * The fields of a merge, as a choice per row (R-C5).
 *
 * Two columns, survivor on the left and checked by default, because that is what the merge does
 * with a field nobody decides (ADR-0022 §1). **A field the two records agree on is shown, not
 * offered**: a choice between two identical values is not a choice, and ten of them between the
 * reviewer and the one field that contradicts is the queue's time spent on nothing.
 */
export function MergeFields({
  title,
  columns,
  fields,
}: {
  readonly title: string;
  readonly columns: readonly string[];
  readonly fields: readonly MergeField[];
}): ReactElement {
  return (
    <div className="overflow-hidden rounded-[10px] border border-grey-200 bg-white">
      <PanelHead title={title} />
      <div className="flex flex-wrap gap-x-3.5 gap-y-0.5 border-b border-grey-100 px-[18px] py-[9px]">
        <span className="w-30 shrink-0 font-mono text-[11px] tracking-[0.08em] text-grey-600 uppercase">
          field
        </span>
        {columns.map((column, index) => (
          <span
            key={index}
            className="min-w-0 flex-1 basis-38 text-[12.5px] font-semibold break-words text-grey-900"
          >
            {column}
          </span>
        ))}
      </div>

      {fields.map((row) => (
        <div
          key={row.field}
          className={`px-[18px] py-2 ${
            row.agreed === null
              ? 'border-b border-differs-200 bg-differs-50'
              : 'border-b border-hairline'
          }`}
        >
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
            <span className="w-30 shrink-0 font-mono text-xs text-grey-600">{row.field}</span>
            {row.agreed !== null ? (
              <span className="min-w-0 flex-1 text-[13.5px] break-words text-grey-500">
                {row.agreed}
              </span>
            ) : (
              row.options.map((option, index) => (
                <label
                  key={index}
                  className="flex min-w-0 flex-1 basis-38 cursor-pointer items-center gap-2 text-[13.5px] text-grey-900"
                >
                  <input
                    type="radio"
                    name={`merge-${row.field}`}
                    checked={option.checked}
                    onChange={option.onPick}
                    className="size-4 shrink-0 accent-accent-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600"
                  />
                  <span className="min-w-0 break-words">{option.value}</span>
                </label>
              ))
            )}
          </div>

          {row.agreed === null && (
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 pt-1.5">
              <span className="w-30 shrink-0" />
              <input
                type="text"
                value={row.typed}
                onChange={(event) => {
                  row.onType(event.target.value);
                }}
                placeholder="or type a value"
                aria-label={`A value you type for ${row.field}`}
                className="min-w-0 flex-1 rounded-[7px] border border-grey-200 bg-white px-2.5 py-1 text-[13px] text-grey-900 placeholder:text-grey-400 focus:border-accent-600 focus:outline-none"
              />
            </div>
          )}

          {row.aside !== null && (
            <p className="pt-1 pl-[calc(--spacing(30)+--spacing(3.5))] text-xs text-grey-500">
              {row.aside}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/** What a verdict line is: the engine's own word for it, and the colour that word already has. */
const VERDICT_TONES: Readonly<Record<string, Tone>> = {
  rejected: 'bad',
  flagged: 'warn',
  cleared: 'good',
  note: 'neutral',
};

export interface Finding {
  /** `cleared`, `flagged`, `rejected`, `note` — the engine's vocabulary, not a paraphrase. */
  readonly verdict: string;
  readonly text: ReactNode;
}

/**
 * The engine's explanation lines. The verdict is not optional: these lines are the engine's own
 * vocabulary, and a reader who is not told what the list is has no way to work it out.
 */
export function FindingsCard({
  title = 'What the rules found',
  note,
  findings,
}: {
  readonly title?: string;
  readonly note?: ReactNode;
  readonly findings: readonly Finding[];
}): ReactElement {
  return (
    <Panel>
      <PanelHead title={title} note={note} />
      <ul className="m-0 flex list-none flex-col gap-[7px] px-[18px] pt-3 pb-4">
        {findings.map((finding, index) => (
          <li key={index} className="grid grid-cols-[86px_minmax(0,1fr)] items-baseline gap-3">
            <span
              className={`inline-flex justify-center rounded-[5px] border py-0.5 font-mono text-[10.5px] tracking-[0.06em] uppercase ${
                TONE_CLASSES[VERDICT_TONES[finding.verdict] ?? 'neutral']
              }`}
            >
              {finding.verdict}
            </span>
            <span className="text-[13.5px] leading-5 text-pretty text-grey-800">
              {finding.text}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/**
 * Why this reached the reviewer, and what a decision writes. Closed by default: it is the same
 * explanation every time for a given kind, and a reviewer working a queue has read it already.
 */
export function Explainer({
  summary = 'Why this reached you, and what a decision writes',
  children,
}: {
  readonly summary?: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <details className="rounded-[10px] border border-grey-200 bg-white px-[18px] py-3">
      <summary className="cursor-pointer list-none text-[13px] font-medium text-grey-700 marker:content-['']">
        {summary}
      </summary>
      <div className="mt-2.5 flex max-w-[70ch] flex-col gap-2 text-[13px] leading-5 text-pretty text-grey-700">
        {children}
      </div>
    </details>
  );
}

/** A section of the body that is not one of the cards above — a search, a list of rows to tick. */
export function DetailSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <Panel>
      <PanelHead title={title} />
      <div className="px-[18px] py-3.5">{children}</div>
    </Panel>
  );
}

/** The detail pane with nothing selected: the queue is the screen, and this says what to do with it. */
export function DetailEmpty({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
      <h1 className="text-[17px] font-semibold tracking-tight text-grey-900">{title}</h1>
      <p className="max-w-[46ch] text-[13px] leading-5 text-pretty text-grey-500">{children}</p>
      <p className="pt-1 font-mono text-[11px] text-grey-400">j / k to move through the queue</p>
    </div>
  );
}
