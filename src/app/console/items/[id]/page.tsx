// One review item, and the decision it asks for (R-C4, R-C5, R-C6). A server component: it reads
// through `@/repo/items` and renders into the detail pane of `ConsoleShell`, and the decision is
// posted by the client component to the one route every item action goes through (ADR-0023,
// ADR-0024, ADR-0028).
//
// The queue stays on screen beside it, so deciding an item does not cost a reviewer their place:
// each decision component is handed `after`, which is the next row down.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactElement, ReactNode } from 'react';

import { proposalOf } from '@/console/decisions/data-quality';
import { poundsRowsOf } from '@/console/decisions/vocabulary';
import { requireReviewer } from '@/console/guard';
import { getDb } from '@/db/client';
import { dayOf } from '@/intake/today';
import { COMPARED_FIELDS, conflictView, DECIDABLE_FIELDS } from '@/repo/identity';
import {
  consentTimeline,
  currentValueOf,
  derivedConsentState,
  findReviewItem,
  type ReviewItemView,
} from '@/repo/items';
import { writableTarget } from '@/repo/resolve';
import {
  Banner,
  DetailBody,
  DetailHeader,
  DetailPane,
  EvidenceCard,
  Explainer,
  Folded,
  Mono,
  Raw,
  humanise,
  titled,
  toneForReviewItem,
  type EvidenceRow,
} from '@/ui';

import { ConsoleShell } from '../../ConsoleShell';
import { type QueuePlace } from '../../place';
import { type SearchParams } from '../../queue-filters';
import { ClinicalHistoryDecision } from './ClinicalHistoryDecision';
import { ConsentDecision } from './ConsentDecision';
import { ITEM_COPY } from './copy';
import { DuplicateDecision, type PairedIntake } from './DuplicateDecision';
import { IdentityDecision } from './IdentityDecision';
import { OrphanDecision } from './OrphanDecision';
import { ValueDecision } from './ValueDecision';
import { VocabularyDecision, type ExcludableRow } from './VocabularyDecision';

export const dynamic = 'force-dynamic';

/** How many of a vocabulary item's rows are listed before the count stands in for the rest. */
const ROWS_SHOWN = 25;

/** What confirming means, per rule, so the buttons are never a bare yes/no. */
const QUESTIONS: Readonly<Record<string, string>> = {
  WEIGHT_UNIT_MISSING_TO_NULL: 'Confirm reads the ticked rows as pounds and writes the conversion.',
  NON_NUMERIC_TO_NULL:
    'Confirm keeps these answers as not answered. Reject records that they mean zero.',
  OUTCOME_OK_ASSUMED_APPROVED: 'Confirm keeps `OK` mapped to approved.',
  VERSION_LABEL_ASSUMED_V2: 'Confirm keeps the label `2.0` mapped to v2.',
  DATE_ORDER_FROM_SEPARATOR: 'Confirm keeps dash as D-M-Y and slash as M-D-Y.',
};

const DEFAULT_QUESTION = 'Confirm records that the importer read this correctly.';

/**
 * Why a `data_quality` item has no value to write, in one line. The consent case names the table
 * the line is still in, because "nothing was stored" invites the question of where it went.
 */
function noRowToCorrect(item: ReviewItemView['item'], rule: string): string {
  if (rule === 'TIMESTAMP_UNPARSED') {
    return 'No canonical event was stored for this line; the raw line is kept in legacy_consent_events_raw.';
  }
  return `Nothing this item names holds ${item.field ?? 'that field'}, so there is no value to write; the raw is kept either way.`;
}

/**
 * A payload's `rows`, when it has them. `payload` is `jsonb` and shaped differently per rule, so it
 * is read defensively here and parsed strictly where a decision depends on it (ADR-0023 item 4).
 */
function payloadRows(payload: unknown): readonly Record<string, unknown>[] {
  const rows = (payload as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

/**
 * How long a value may be before it is folded rather than laid out flat. Roughly two lines of the
 * evidence column: past that one field starts hiding the fields under it.
 */
const LONG = 160;

/** What a folded value says about itself while folded — its size, in its own units. */
function sizeOf(value: object, json: string): string {
  if (Array.isArray(value)) return `${value.length} entries · ${json.length} characters`;
  return `${Object.keys(value).length} keys · ${json.length} characters`;
}

/** Anything a payload holds, rendered as what it is rather than as `[object Object]`. */
const shown = (value: unknown): ReactNode => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number' || typeof value === 'boolean') return <Raw>{String(value)}</Raw>;
  if (typeof value === 'string') {
    return value.length > LONG ? (
      <Folded summary={`${value.length} characters`}>
        <Raw>{value}</Raw>
      </Folded>
    ) : (
      <Raw>{value}</Raw>
    );
  }
  const json = JSON.stringify(value);
  return json.length > LONG ? (
    <Folded summary={sizeOf(value, json)}>
      <Raw>{json}</Raw>
    </Folded>
  ) : (
    <Raw>{json}</Raw>
  );
};

function evidenceOf(item: ReviewItemView['item']): EvidenceRow[] {
  const payload = item.payload as Record<string, unknown>;
  return Object.entries(payload)
    .filter(([key]) => key !== 'rows' && key !== 'actions' && key !== 'note')
    .map(([term, value]) => ({ term, value: shown(value) }));
}

function excludable(rows: ReturnType<typeof poundsRowsOf>): ExcludableRow[] {
  return rows.map((row) => ({
    legacyId: row.legacy_id,
    label: `${row.legacy_id} · raw ${row.raw_weight ?? '?'}`,
    keeping: `${row.as_kilograms?.weight_kg ?? '?'} kg, BMI ${row.as_kilograms?.bmi ?? '?'}`,
    instead: `${row.as_pounds.weight_kg} kg, BMI ${row.as_pounds.bmi ?? '?'}`,
  }));
}

/** The look-alike patients an orphan item carries as context. Shape-tolerant: `payload` is jsonb. */
function lookAlikes(payload: unknown): readonly Record<string, unknown>[] {
  const rows = (payload as { look_alikes?: unknown }).look_alikes;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

/** One payload row as a line: `key value · key value`. Values are scalars or, rarely, nested. */
const describe = (row: Record<string, unknown>): string =>
  Object.entries(row)
    .map(([key, value]) => `${key} ${scalar(value)}`)
    .join(' · ');

const scalar = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- narrowed to a primitive above.
  return String(value);
};

/** The pair a same-day item names, each summarised by what a reviewer compares them on. */
function pairedIntakes(payload: unknown): PairedIntake[] {
  const rows = (payload as { intakes?: unknown }).intakes;
  if (!Array.isArray(rows)) return [];
  return (rows as Record<string, unknown>[]).flatMap((row) => {
    const intakeId = row.intake_id;
    if (typeof intakeId !== 'string') return [];
    return [{ intakeId, summary: describe(row) }];
  });
}

/**
 * The evidence every item shows, whatever kind it is: the line above it, what the export gave, and
 * the explanation folded away at the bottom. The kinds that need more put it between the two by
 * passing `extra`.
 */
function Evidence({
  view,
  banner,
  extra,
}: {
  readonly view: ReviewItemView;
  readonly banner?: string | null;
  readonly extra?: ReactNode;
}): ReactElement {
  const copy = ITEM_COPY[view.item.type];
  const said = banner === undefined ? copy.banner : banner;
  return (
    <>
      {said !== null && <Banner>{said}</Banner>}
      <EvidenceCard note="as the export gave it" rows={evidenceOf(view.item)} />
      {extra}
      <Explainer>
        <p>{copy.why}</p>
        <p>{copy.writes}</p>
        <p>j / k move through the queue; the key beside each button also takes it.</p>
      </Explainer>
    </>
  );
}

/**
 * A decision is taken once. The queue's scope links straight to resolved and dismissed items, and
 * a live form on one of those lets a reviewer write a reason and press a button only to be told
 * 409 afterwards. What a closed item shows instead is the decision that was taken.
 */
function Closed({ view }: { readonly view: ReviewItemView }): ReactElement {
  const { item } = view;
  return (
    <DetailBody>
      <Banner>A decision is taken once, and this one is taken.</Banner>
      <EvidenceCard
        title="The decision that was taken"
        rows={[
          { term: 'outcome', value: humanise(item.status) },
          { term: 'by', value: item.resolvedBy ?? '—' },
          { term: 'when', value: item.resolvedAt === null ? '—' : dayOf(item.resolvedAt) },
          { term: 'why', value: item.resolutionNote ?? '—' },
        ]}
      />
      <EvidenceCard note="as the export gave it" rows={evidenceOf(item)} />
    </DetailBody>
  );
}

/**
 * The competing versions of the truth, side by side (R-C4). The values come from the canonical
 * rows as they are now, not from the item's payload snapshot, because that is what a merge will
 * write; the payload says why the item was raised.
 */
async function IdentityConflict({
  view,
  after,
}: {
  readonly view: ReviewItemView;
  readonly after: string;
}): Promise<ReactElement> {
  const conflict = await conflictView(getDb(), view.item);
  const decidable = new Set<string>(DECIDABLE_FIELDS);
  const differing = new Set<string>(conflict.differing);

  return (
    <IdentityDecision
      itemId={view.item.id}
      after={after}
      candidates={conflict.candidates.map((candidate) => ({
        patientId: candidate.patientId,
        label: candidate.fields.full_name ?? candidate.patientId,
        intakeCount: candidate.intakeCount,
        consent: Object.values(candidate.consentStates).join(', ') || 'no record',
        legacyIds: candidate.legacyIds,
      }))}
      rows={COMPARED_FIELDS.map((field) => ({
        field,
        values: conflict.candidates.map((candidate) => candidate.fields[field]),
        differs: differing.has(field),
        decidable: decidable.has(field),
      }))}
    >
      <Evidence
        view={view}
        extra={
          <EvidenceCard
            title="Why these two are together"
            rows={[
              { term: 'matched on', value: conflict.matchedKeys.join(', ') || '—' },
              { term: 'contradicts on', value: conflict.contradictions.join(', ') || '—' },
              { term: 'tier', value: conflict.tier === null ? '—' : String(conflict.tier) },
            ]}
          />
        }
      />
    </IdentityDecision>
  );
}

/**
 * The consent log, in `at` order, next to the state derived from it. The log is evidence and the
 * state is what we act on, and a reviewer deciding what to do needs to see both (`CLAUDE.md` §6).
 */
async function ConsentItem({
  view,
  after,
}: {
  readonly view: ReviewItemView;
  readonly after: string;
}): Promise<ReactElement> {
  const timeline = await consentTimeline(getDb(), view.item);
  // The state as it stands now, not the one the payload snapshotted at import: a reviewer may
  // already have established it, and the buttons below depend on which it is (ADR-0025).
  const derived = await derivedConsentState(getDb(), view.item);
  const conflicted = derived === 'conflict';

  return (
    <ConsentDecision itemId={view.item.id} after={after} conflicted={conflicted}>
      <Evidence
        view={view}
        banner={
          conflicted
            ? 'The log contradicts itself — it revokes a consent that was never given — so no rule can say what is true. Record the state a person established.'
            : `Derived state: ${derived ?? 'none'}. The log is evidence; the state is what we act on.`
        }
        extra={
          <EvidenceCard
            title="The consent log for this patient"
            note={`state now: ${derived ?? 'none'}`}
            rows={
              timeline.length === 0
                ? [{ term: 'events', value: 'None at all. That is what the item is about.' }]
                : timeline.map((event, index) => ({
                    term: `event ${index + 1}`,
                    value: `${event.at} · ${event.type} ${event.action}${
                      event.version === null ? '' : ` (${event.version})`
                    }`,
                  }))
            }
          />
        }
      />
    </ConsentDecision>
  );
}

async function Decision({
  view,
  after,
}: {
  readonly view: ReviewItemView;
  readonly after: string;
}): Promise<ReactElement> {
  const { item, rule } = view;

  if (item.status !== 'open') return <Closed view={view} />;

  if (item.type === 'identity_conflict') return <IdentityConflict view={view} after={after} />;
  if (item.type === 'consent') return <ConsentItem view={view} after={after} />;

  if (item.type === 'orphan_intake') {
    const found = lookAlikes(item.payload);
    return (
      <OrphanDecision itemId={item.id} after={after}>
        <Evidence
          view={view}
          extra={
            <EvidenceCard
              title="Patients that look like this one"
              note="same height, weight within 10 %, signed up at most a year earlier"
              rows={
                found.length === 0
                  ? [{ term: 'look-alikes', value: 'None. Search below.' }]
                  : found.map((row, index) => ({
                      term: `look-alike ${index + 1}`,
                      value: describe(row),
                    }))
              }
            />
          }
        />
      </OrphanDecision>
    );
  }

  if (item.type === 'data_quality') {
    const proposal = proposalOf(item);
    const current = await currentValueOf(getDb(), item);
    // The same question the server asks before it writes, so the screen cannot offer a correction
    // the route refuses (ADR-0026 item 2).
    const uncorrectable = writableTarget(item) === null ? noRowToCorrect(item, rule) : null;
    return (
      <ValueDecision
        itemId={item.id}
        after={after}
        field={item.field ?? 'the value'}
        proposal={proposal}
        uncorrectable={uncorrectable}
      >
        <Evidence
          view={view}
          banner={
            proposal === null
              ? 'The raw row is kept either way.'
              : `The detector proposes ${proposal.value}${proposal.rule === null ? '' : ` (${proposal.rule})`}. The raw row is kept either way.`
          }
          extra={
            <EvidenceCard
              title="The value as it stands"
              rows={[
                { term: 'field', value: <Mono>{item.field ?? '—'}</Mono> },
                { term: 'stored value', value: current ?? 'empty' },
                {
                  term: 'proposal',
                  value:
                    proposal === null ? 'none' : `${proposal.value}  (${proposal.rule ?? '—'})`,
                },
              ]}
            />
          }
        />
      </ValueDecision>
    );
  }

  if (item.type === 'clinical_history') {
    return (
      <ClinicalHistoryDecision itemId={item.id} after={after}>
        <Evidence
          view={view}
          extra={
            view.intake === null ? null : (
              <EvidenceCard
                title="The intake this is about"
                rows={[
                  {
                    term: 'intake',
                    value: (
                      <Link href={`/console/intakes/${view.intake.id}`}>
                        {view.intake.intakeId ?? view.intake.id}
                      </Link>
                    ),
                  },
                  { term: 'state', value: humanise(view.intake.state) },
                ]}
              />
            )
          }
        />
      </ClinicalHistoryDecision>
    );
  }

  if (item.type === 'duplicate_intake') {
    const pair = pairedIntakes(item.payload);
    return (
      <DuplicateDecision itemId={item.id} after={after} intakes={pair}>
        <Evidence
          view={view}
          extra={
            <EvidenceCard
              title="The two intakes, side by side"
              rows={pair.map((intake) => ({
                key: intake.intakeId,
                term: intake.intakeId,
                value: intake.summary,
              }))}
            />
          }
        />
      </DuplicateDecision>
    );
  }

  // Always true today, and that is the point: the seven returns above cover `ReviewItemType`, so
  // `tsc` narrows this to a certainty. It is written as a branch rather than dropped so that the
  // two lines below it stay reachable — the compile-time proof, and the pane a new kind would show.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- exhaustiveness, not a branch.
  if (item.type === 'vocabulary') {
    const rows = payloadRows(item.payload);
    const columns = rows[0] === undefined ? [] : Object.keys(rows[0]);
    return (
      <VocabularyDecision
        itemId={item.id}
        after={after}
        rows={excludable(poundsRowsOf(item, rule))}
      >
        <Evidence
          view={view}
          banner={QUESTIONS[rule] ?? DEFAULT_QUESTION}
          extra={
            rows.length === 0 ? null : (
              <EvidenceCard
                title={`Rows this applies to (${rows.length})`}
                note={
                  rows.length > ROWS_SHOWN
                    ? `the first ${ROWS_SHOWN}; all ${rows.length} are covered by this one decision`
                    : undefined
                }
                rows={rows.slice(0, ROWS_SHOWN).map((row, index) => ({
                  term: String(index + 1),
                  value: columns.map((key) => (
                    <span key={key}>
                      {key}: {shown(row[key])}{' '}
                    </span>
                  )),
                }))}
              />
            )
          }
        />
      </VocabularyDecision>
    );
  }

  // `item.type` is `never` here. Adding a review-item type without giving it a screen fails `tsc`
  // on this line rather than reaching a reviewer as a pane with nothing to decide on it.
  item.type satisfies never;
  return (
    <DetailBody>
      <Banner>
        {`The screen for a ${humanise(item.type)} item is not built. Nothing here can be decided
          until it is, and the API refuses a decision it cannot carry out.`}
      </Banner>
      <EvidenceCard note="as the export gave it" rows={evidenceOf(item)} />
    </DetailBody>
  );
}

export default async function ReviewItemPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>;
  readonly searchParams: Promise<SearchParams>;
}): Promise<ReactElement> {
  const reviewer = await requireReviewer();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const view = await findReviewItem(getDb(), id);
  if (view === null) notFound();

  const { item, rule } = view;

  return (
    <ConsoleShell
      reviewer={reviewer}
      params={query}
      selected={{ kind: 'review_item', id: item.id }}
      detail={(place: QueuePlace) => (
        <DetailPane>
          <DetailHeader
            tone={toneForReviewItem(item.type)}
            kindLabel={titled(item.type)}
            rule={rule}
            raised={dayOf(item.createdAt)}
            position={place.position}
            prevHref={place.prevHref}
            nextHref={place.nextHref}
            title={item.title}
            patient={
              view.patient === null ? (
                'No patient'
              ) : (
                <Link href={`/console/patients/${view.patient.id}`}>{view.patient.name}</Link>
              )
            }
            patientMeta={[
              humanise(item.status),
              view.intake === null
                ? null
                : `intake ${view.intake.intakeId ?? view.intake.id} · ${humanise(view.intake.state)}`,
              item.reason,
            ]
              .filter((part) => part !== null && part !== '')
              .join(' · ')}
          />
          <Decision view={view} after={place.nextHref ?? '/console'} />
        </DetailPane>
      )}
    />
  );
}
