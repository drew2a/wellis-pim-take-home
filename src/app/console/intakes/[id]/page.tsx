// One intake, as the reviewer who has to decide it sees it (R-C7): what the patient answered, and
// what the rules made of it.
//
// This is the screen ADR-0020 kept the engine's own words *off the patient's* page for. Here they
// belong: "flagged: BMI 27.0 with no weight-related condition" is a sentence written to be
// auditable, and this is the audience it was written for.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';

import { requireReviewer } from '@/console/guard';
import { getDb } from '@/db/client';
import { blocksApproval, edgeFor } from '@/intake/machine';
import { dayOf } from '@/intake/today';
import { findIntake, type IntakeView } from '@/repo/intakes';
import { currentRules } from '@/rules/load';
import {
  Card,
  Caption,
  Definitions,
  Findings,
  Hint,
  Page,
  PageHeader,
  Raw,
  SectionTitle,
  StateBadge,
  humanise,
  type Definition,
} from '@/ui';

import { IntakeDecision } from './IntakeDecision';

export const dynamic = 'force-dynamic';

/**
 * One thing the matcher found (`@/eligibility/terms`): the text it matched, and the ruleset term
 * that caught it. Both, because that is the pair the evaluation stores and the pair a reviewer
 * needs — the term alone does not show what the patient wrote, and the text alone does not show
 * which rule it tripped (ADR-0015 item 6).
 */
const isTermMatch = (input: unknown): input is { term: string; text: string } =>
  typeof input === 'object' &&
  input !== null &&
  typeof (input as { term?: unknown }).term === 'string' &&
  typeof (input as { text?: unknown }).text === 'string';

/**
 * What the patient wrote, and the ruleset term behind it where that adds something. Of the 1725
 * matches this database holds, 1503 quote the term verbatim and 184 differ only in case, so naming
 * the term every time would be noise on 98 % of them; the 38 that carry more — `rybelsus 7 mg`
 * caught by `rybelsus`, `medullair schildkliercarcinoom familie` by `schildkliercarcinoom` — are
 * exactly the ones where a reviewer needs to see why it matched.
 */
const termMatch = (match: { term: string; text: string }): string =>
  match.text.toLowerCase() === match.term.toLowerCase()
    ? match.text
    : `${match.text} (${match.term})`;

const value = (input: unknown): string => {
  if (input === null || input === undefined) return '—';
  if (isTermMatch(input)) return termMatch(input);
  // Each element through this function, never `join` on its own: `Array.prototype.join` stringifies
  // an element with `String()`, so an array of objects rendered as `[object Object]` — which is
  // what the panel explaining a medical verdict showed for every term the matcher found.
  if (Array.isArray(input)) return input.length === 0 ? 'none' : input.map(value).join(', ');
  if (typeof input === 'object') return JSON.stringify(input);
  if (typeof input === 'boolean') return input ? 'yes' : 'no';
  if (typeof input === 'number') return String(input);
  return typeof input === 'string' ? input : '—';
};

/**
 * What the patient submitted, **as they gave it** (R-C7). A new-flow intake keeps its answers step
 * by step (ADR-0015 item 1); an imported one has the canonical columns the mapper wrote, and its
 * raw row is on the patient's page.
 */
function submission(intake: IntakeView['intake']): Definition[] {
  if (intake.answers !== null) {
    return Object.entries(intake.answers)
      .filter(([step]) => step !== 'formVersion')
      .flatMap(([step, answers]) =>
        Object.entries(answers as Record<string, unknown>).map(([field, given]) => ({
          term: `${step}.${field}`,
          value: <Raw>{value(given)}</Raw>,
        })),
      );
  }
  return [
    { term: 'submitted', value: intake.submittedAt ?? '—' },
    { term: 'questionnaire', value: intake.questionnaireVersionLabel ?? '—' },
    { term: 'weight_kg', value: <Raw>{value(intake.weightKg)}</Raw> },
    { term: 'height_cm', value: <Raw>{value(intake.heightCm)}</Raw> },
    { term: 'meds_current', value: <Raw>{value(intake.medsCurrentRaw)}</Raw> },
    { term: 'conditions', value: <Raw>{value(intake.conditionsRaw)}</Raw> },
    { term: 'alcohol_units_week', value: <Raw>{value(intake.alcoholUnitsWeek)}</Raw> },
    { term: 'legacy outcome', value: `${intake.outcome} (${intake.outcomeRaw ?? '—'})` },
    { term: 'reviewer note', value: <Raw>{value(intake.reviewerNote)}</Raw> },
  ];
}

/** What the rules saw, so the verdict explains itself without re-running the engine (ADR-0010). */
function inputsOf(evaluation: NonNullable<IntakeView['evaluation']>): Definition[] {
  return Object.entries(evaluation.inputs as unknown as Record<string, unknown>).map(
    ([term, given]) => ({ term, value: <Raw>{value(given)}</Raw> }),
  );
}

export default async function IntakePage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}): Promise<ReactElement> {
  const reviewer = await requireReviewer();
  const view = await findIntake(getDb(), (await params).id);
  if (view === null) notFound();

  const { intake, evaluation, claim } = view;
  const blockedBy =
    evaluation === null
      ? []
      : evaluation.matched.filter((rule) =>
          blocksApproval([rule], currentRules().precedence.absolute_rejects),
        );

  return (
    <Page>
      <PageHeader title={intake.intakeId ?? 'New intake'}>
        <StateBadge state={intake.state} />
        <Link href="/console">Back to the queue</Link>
      </PageHeader>

      <Card>
        <Definitions
          items={[
            { term: 'state', value: humanise(intake.state) },
            {
              term: 'patient',
              value:
                view.patient === null ? (
                  <Caption>none — this intake is an orphan</Caption>
                ) : (
                  <Link href={`/console/patients/${view.patient.id}`}>{view.patient.name}</Link>
                ),
            },
            ...(claim === null
              ? []
              : [{ term: 'claimed by', value: `${claim.reviewer}, ${dayOf(claim.at)}` }]),
          ]}
        />
      </Card>

      <SectionTitle>What the patient answered</SectionTitle>
      <Card>
        <Definitions items={submission(intake)} />
      </Card>

      <SectionTitle>What the rules made of it</SectionTitle>
      <Card>
        {evaluation === null ? (
          <Hint>
            No stored evaluation. Nobody can say what the rules found, so this intake cannot be
            approved — only rejected, or left where it is.
          </Hint>
        ) : (
          <>
            <Definitions
              items={[
                { term: 'outcome', value: humanise(evaluation.engineOutcome) },
                { term: 'ruleset', value: <Raw>{evaluation.rulesetVersion}</Raw> },
                {
                  term: 'rules that fired',
                  value: evaluation.matched.length === 0 ? 'none' : evaluation.matched.join(', '),
                },
                {
                  term: 'evaluated',
                  value: `${dayOf(evaluation.evaluatedAt)}${evaluation.shadow ? ' (shadow: today’s rules over a legacy intake)' : ''}`,
                },
                ...inputsOf(evaluation),
              ]}
            />
            <Findings title="Why, in the engine's own words" items={evaluation.reasons} />
          </>
        )}
      </Card>

      <SectionTitle>Your decision</SectionTitle>
      <IntakeDecision
        intakeId={intake.id}
        canClaim={edgeFor(intake.state, 'in_review') !== undefined}
        canDecide={intake.state === 'in_review'}
        isDoctor={reviewer.role === 'doctor'}
        approvalBlockedBy={blockedBy}
      />
    </Page>
  );
}
