// One review item, and the decision it asks for (R-C4, R-C5, R-C6). A server component: it reads
// through `@/repo/items` and renders, and the decision is posted by the client component to the
// one route every item action goes through (ADR-0023, ADR-0024).
//
// Each item type gets its own view as its commit lands; until then the page says so rather than
// offering a decision the route would refuse.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactElement, ReactNode } from 'react';

import { poundsRowsOf } from '@/console/decisions/vocabulary';
import { requireReviewer } from '@/console/guard';
import { getDb } from '@/db/client';
import { dayOf } from '@/intake/today';
import { COMPARED_FIELDS, conflictView, DECIDABLE_FIELDS } from '@/repo/identity';
import { findReviewItem, type ReviewItemView } from '@/repo/items';
import {
  Badge,
  Caption,
  Card,
  Definitions,
  Hint,
  Page,
  PageHeader,
  Raw,
  SectionTitle,
  humanise,
  toneForReviewItem,
  type Definition,
} from '@/ui';

import { DuplicateDecision, type PairedIntake } from './DuplicateDecision';
import { IdentityDecision } from './IdentityDecision';
import { OrphanDecision } from './OrphanDecision';
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
 * Rejecting an inference writes nothing, and that is the design: the rule lives in `rules/v1.json`
 * and a changed rule is a new ruleset and a re-import. The answer, and the rows it applies to, are
 * what the console records (ADR-0005).
 */
const REJECT_MEANS =
  'Rejecting records the answer against the rows listed; it does not rewrite them. ' +
  'Changing the rule is a new ruleset version and a re-import.';

/**
 * A payload's `rows`, when it has them. `payload` is `jsonb` and shaped differently per rule, so it
 * is read defensively here and parsed strictly where a decision depends on it (ADR-0023 item 4).
 */
function payloadRows(payload: unknown): readonly Record<string, unknown>[] {
  const rows = (payload as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

/** Anything a payload holds, rendered as what it is rather than as `[object Object]`. */
const shown = (value: unknown): ReactNode => {
  if (value === null || value === undefined) return <Caption>—</Caption>;
  if (typeof value === 'string') return <Raw>{value}</Raw>;
  if (typeof value === 'number' || typeof value === 'boolean') return <Raw>{String(value)}</Raw>;
  return <Raw>{JSON.stringify(value)}</Raw>;
};

function evidenceOf(item: ReviewItemView['item']): Definition[] {
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
 * The competing versions of the truth, side by side (R-C4). The values come from the canonical
 * rows as they are now, not from the item's payload snapshot, because that is what a merge will
 * write; the payload says why the item was raised.
 */
async function IdentityConflict({
  view,
}: {
  readonly view: ReviewItemView;
}): Promise<ReactElement> {
  const conflict = await conflictView(getDb(), view.item);
  const decidable = new Set<string>(DECIDABLE_FIELDS);
  const differing = new Set<string>(conflict.differing);

  return (
    <>
      <SectionTitle>Why these two are together</SectionTitle>
      <Card>
        <Definitions
          items={[
            { term: 'matched on', value: conflict.matchedKeys.join(', ') || '—' },
            { term: 'contradicts on', value: conflict.contradictions.join(', ') || '—' },
            { term: 'tier', value: conflict.tier === null ? '—' : String(conflict.tier) },
          ]}
        />
      </Card>

      <SectionTitle>Your decision</SectionTitle>
      <IdentityDecision
        itemId={view.item.id}
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
      />
    </>
  );
}

export default async function ReviewItemPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}): Promise<ReactElement> {
  await requireReviewer();
  const view = await findReviewItem(getDb(), (await params).id);
  if (view === null) notFound();

  const { item, rule } = view;
  const rows = payloadRows(item.payload);
  const columns = rows[0] === undefined ? [] : Object.keys(rows[0]);

  return (
    <Page>
      <PageHeader title={item.title}>
        <Badge tone={toneForReviewItem(item.type)}>{humanise(item.type)}</Badge>
        <Link href="/console">Back to the queue</Link>
      </PageHeader>

      <Card>
        <Definitions
          items={[
            { term: 'rule', value: <Raw>{rule}</Raw> },
            { term: 'raised', value: dayOf(item.createdAt) },
            { term: 'status', value: humanise(item.status) },
            ...(item.reason === null ? [] : [{ term: 'reason', value: item.reason }]),
            ...(view.patient === null
              ? []
              : [
                  {
                    term: 'patient',
                    value: (
                      <Link href={`/console/patients/${view.patient.id}`}>{view.patient.name}</Link>
                    ),
                  },
                ]),
            ...evidenceOf(item),
          ]}
        />
      </Card>

      {item.type === 'identity_conflict' && <IdentityConflict view={view} />}

      {item.type === 'orphan_intake' && (
        <>
          <SectionTitle>Patients that look like this one</SectionTitle>
          <Card>
            <Hint>
              Context, not a proposal: the importer attached none of them, because even a single
              look-alike is a guess. Same height, weight within 10 %, signed up at most a year
              earlier.
            </Hint>
            {lookAlikes(item.payload).length === 0 ? (
              <Hint>None. Search below.</Hint>
            ) : (
              <Definitions
                items={lookAlikes(item.payload).map((row, index) => ({
                  term: String(index + 1),
                  value: describe(row),
                }))}
              />
            )}
          </Card>
          <SectionTitle>Your decision</SectionTitle>
          <OrphanDecision itemId={item.id} />
        </>
      )}

      {item.type === 'duplicate_intake' && (
        <>
          <SectionTitle>The two intakes, side by side</SectionTitle>
          <Card>
            <Definitions
              items={pairedIntakes(item.payload).map((intake) => ({
                term: intake.intakeId,
                value: intake.summary,
              }))}
            />
          </Card>
          <SectionTitle>Your decision</SectionTitle>
          <DuplicateDecision itemId={item.id} intakes={pairedIntakes(item.payload)} />
        </>
      )}

      {item.type === 'vocabulary' ? (
        <>
          {rows.length > 0 && (
            <>
              <SectionTitle>{`Rows this applies to (${rows.length})`}</SectionTitle>
              <Card>
                <Definitions
                  items={rows.slice(0, ROWS_SHOWN).map((row, index) => ({
                    term: String(index + 1),
                    value: columns.map((key) => (
                      <span key={key}>
                        {key}: {shown(row[key])}{' '}
                      </span>
                    )),
                  }))}
                />
                {rows.length > ROWS_SHOWN && (
                  <Hint>{`…and ${rows.length - ROWS_SHOWN} more, all of them covered by this one decision.`}</Hint>
                )}
              </Card>
            </>
          )}
          <SectionTitle>Your decision</SectionTitle>
          <Hint>{REJECT_MEANS}</Hint>
          <VocabularyDecision
            itemId={item.id}
            question={QUESTIONS[rule] ?? DEFAULT_QUESTION}
            rows={excludable(poundsRowsOf(item, rule))}
          />
        </>
      ) : (
        !['identity_conflict', 'orphan_intake', 'duplicate_intake'].includes(item.type) && (
          <>
            <SectionTitle>Your decision</SectionTitle>
            <Card>
              <Hint>
                {`The screen for a ${humanise(item.type)} item is not built yet. Nothing here can be
                decided until it is, and the API refuses a decision it cannot carry out.`}
              </Hint>
            </Card>
          </>
        )
      )}
    </Page>
  );
}
