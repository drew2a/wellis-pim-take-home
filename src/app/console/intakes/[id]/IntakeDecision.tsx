'use client';

// Claiming an intake, and deciding it (R-C8). The buttons a reviewer cannot use are absent, and
// that is a courtesy: the server refuses the same move with the machine's own words, and this
// component could not talk its way past it (R-T4, ADR-0014 item 3).
import type { ReactElement, ReactNode } from 'react';

import { useDecide } from '@/app/console/useDecide';
import { DecisionBar, DetailBody, ENTER, NEEDS_A_NOTE } from '@/ui';

export function IntakeDecision({
  intakeId,
  after,
  canClaim,
  canDecide,
  approvalBlockedBy,
  children,
}: {
  readonly intakeId: string;
  readonly after: string;
  readonly canClaim: boolean;
  /** True once a named person has it: `in_review` is the only state a decision is taken from. */
  readonly canDecide: boolean;
  /** The rules the ruleset calls absolute that this intake matched, if any (Q1). */
  readonly approvalBlockedBy: readonly string[];
  readonly children: ReactNode;
}): ReactElement {
  const decide = useDecide(`/api/console/intakes/${intakeId}/transition`, after);
  const blocked = approvalBlockedBy.length > 0;

  // Claiming keeps the reviewer on this intake: they claimed it in order to decide it, and the
  // decision is the next thing they do. Approving and rejecting move on to the next row.
  if (canClaim) {
    return (
      <>
        <DetailBody>{children}</DetailBody>
        {/* No reason field: the route's schema refuses a note on this edge and writes "claimed for
            review" itself, so a box here would throw away whatever was typed into it — and, since
            claiming keeps the reviewer on this screen, hand it to the approval as a pre-filled
            reason for a decision it was not written for. */}
        <DecisionBar
          unavailable="Claiming puts your name on this intake. Nobody else can then claim it, and the audit records it as “claimed for review”, with the time. Approving and rejecting take your own words."
          error={decide.failure}
          actions={[
            {
              label: 'Claim for review',
              variant: 'primary',
              hint: ENTER,
              busy: decide.busy === 'in_review',
              disabled: decide.busy !== null,
              onPick: () => {
                decide.send('in_review', { to: 'in_review' }, true);
              },
            },
          ]}
        />
      </>
    );
  }

  if (!canDecide) {
    return (
      <>
        <DetailBody>{children}</DetailBody>
        <DecisionBar
          unavailable="This intake takes no decision from here. The legacy process decided it, and this console does not rewrite what it decided — a disagreement with today’s rules is a clinical history item."
          actions={[]}
        />
      </>
    );
  }

  const stopped = !decide.noted || decide.busy !== null;

  return (
    <>
      <DetailBody>{children}</DetailBody>
      <DecisionBar
        note={decide.note}
        onNote={decide.setNote}
        placeholder="Your decision in a sentence — recorded as the audit reason"
        unavailable={
          !decide.noted
            ? NEEDS_A_NOTE
            : blocked
              ? `The rules rejected this absolutely (${approvalBlockedBy.join(', ')}), which a reviewer cannot resolve in the patient’s favour. Rejecting is still yours.`
              : undefined
        }
        error={decide.failure}
        actions={[
          {
            label: 'Approve',
            variant: 'primary',
            hint: ENTER,
            busy: decide.busy === 'approved',
            disabled: stopped || blocked,
            onPick: () => {
              decide.send('approved', { to: 'approved', note: decide.note });
            },
          },
          {
            label: 'Reject',
            variant: 'danger',
            hint: 'R',
            busy: decide.busy === 'rejected',
            disabled: stopped,
            onPick: () => {
              decide.send('rejected', { to: 'rejected', note: decide.note });
            },
          },
        ]}
      />
    </>
  );
}
