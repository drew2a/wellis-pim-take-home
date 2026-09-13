// The intake state machine (ADR-0014): the edge table, who may take each edge, and what each edge
// demands. Pure and I/O-free (`CLAUDE.md` §2) — it decides, it never writes. `transitionIntake` in
// `./transition.ts` is the only code that acts on what it decides, and the database trigger
// installed by `drizzle/0007_intake_state_machine.sql` mirrors the same table as a second lock.
//
// Every refusal is one error type and one loudness: a pair that is not an edge, an actor of the
// wrong kind, a reviewer without the role, a blocked approval and a missing reason are all "this
// transition does not exist for you".
import { intakeStateEnum, type ReviewerRole } from '@/db/schema';
import type { MatchedRule } from '@/eligibility/types';
import type { RejectRule } from '@/rules/schema';

export type IntakeState = (typeof intakeStateEnum.enumValues)[number];

export const INTAKE_STATES: readonly IntakeState[] = intakeStateEnum.enumValues;

/**
 * The states an intake may be created in: `draft` for the new flow, a legacy state for the
 * importer. Everything else is reached by taking an edge (ADR-0014 item 6).
 */
export const INITIAL_STATES: readonly IntakeState[] = [
  'draft',
  'legacy_approved',
  'legacy_rejected',
  'legacy_pending',
  'legacy_expired',
];

export const isLegacyState = (state: IntakeState): boolean => state.startsWith('legacy_');

export type ActorKind = 'process' | 'reviewer';

export type TransitionActor =
  | { readonly kind: 'process'; readonly name: string }
  | {
      readonly kind: 'reviewer';
      readonly id: string;
      readonly name: string;
      readonly role: ReviewerRole;
    };

export interface TransitionEdge {
  readonly from: IntakeState;
  readonly to: IntakeState;
  readonly actorKind: ActorKind;
  /** Only a reviewer holding this role may take the edge; any reviewer may when absent. */
  readonly requiredRole?: ReviewerRole;
  /** The audit entry must name the ruleset that decided (R-B8): the engine's edges. */
  readonly requiresRulesetVersion?: boolean;
  /**
   * The edge is refused when the intake's governing evaluation matched a rule the ruleset calls an
   * absolute reject. Q1 makes the age rule absolute because it is a legal gate a reviewer cannot
   * resolve in the patient's favour, so approval is the one edge it must close (ADR-0014 item 3).
   */
  readonly refusesAbsoluteReject?: boolean;
}

/** The ten legal ordered pairs. Creation is not a transition and is not in the table. */
export const TRANSITIONS: readonly TransitionEdge[] = [
  { from: 'draft', to: 'submitted', actorKind: 'process' },
  { from: 'submitted', to: 'auto_cleared', actorKind: 'process', requiresRulesetVersion: true },
  { from: 'submitted', to: 'auto_flagged', actorKind: 'process', requiresRulesetVersion: true },
  { from: 'submitted', to: 'auto_rejected', actorKind: 'process', requiresRulesetVersion: true },
  { from: 'auto_cleared', to: 'in_review', actorKind: 'reviewer' },
  { from: 'auto_flagged', to: 'in_review', actorKind: 'reviewer' },
  { from: 'auto_rejected', to: 'in_review', actorKind: 'reviewer' },
  // The machine's only door out of the legacy states, and only the non-terminal one has it: a
  // person deciding to finish what the legacy process left open (ADR-0014 item 7).
  { from: 'legacy_pending', to: 'in_review', actorKind: 'reviewer' },
  {
    from: 'in_review',
    to: 'approved',
    actorKind: 'reviewer',
    requiredRole: 'doctor',
    refusesAbsoluteReject: true,
  },
  { from: 'in_review', to: 'rejected', actorKind: 'reviewer', requiredRole: 'doctor' },
];

export function edgeFor(from: IntakeState, to: IntakeState): TransitionEdge | undefined {
  return TRANSITIONS.find((edge) => edge.from === from && edge.to === to);
}

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: IntakeState,
    readonly to: IntakeState,
    detail: string,
  ) {
    super(`${from} -> ${to} is not allowed: ${detail}`);
    this.name = 'IllegalTransitionError';
  }
}

/**
 * Whether the governing evaluation closes approval: it matched a rule this ruleset calls absolute.
 *
 * The list comes from the ruleset rather than naming `age_below_minimum` here, so a ruleset that
 * makes a second rule absolute closes approval for it too without a code change. **Limit:** the
 * list passed in is the ruleset in force, not necessarily the one that produced the evaluation.
 * With one ruleset version in the repository they are the same; a second version would have to be
 * loaded by the evaluation's own `rulesetVersion`.
 */
export function blocksApproval(
  matched: readonly MatchedRule[],
  absoluteRejects: readonly RejectRule[],
): boolean {
  return matched.some((rule) => (absoluteRejects as readonly string[]).includes(rule));
}

export interface TransitionCheck {
  readonly from: IntakeState;
  readonly to: IntakeState;
  readonly actor: TransitionActor;
  readonly reason: string;
  readonly rulesetVersion?: string | null;
  /**
   * The `matched` rules of the intake's governing evaluation, or null when it has none. Read only
   * by an edge that refuses an absolute reject; the caller fetches it, the rule lives here.
   */
  readonly matched?: readonly MatchedRule[] | null | undefined;
  readonly absoluteRejects: readonly RejectRule[];
}

/** Returns the edge that permits the transition, or throws `IllegalTransitionError`. */
export function checkTransition(check: TransitionCheck): TransitionEdge {
  const { from, to, actor } = check;
  const refuse = (detail: string): IllegalTransitionError =>
    new IllegalTransitionError(from, to, detail);

  const edge = edgeFor(from, to);
  if (edge === undefined) throw refuse('no such edge in the state machine');
  if (edge.actorKind !== actor.kind) {
    throw refuse(`it is taken by a ${edge.actorKind}, not by a ${actor.kind}`);
  }
  if (edge.requiredRole !== undefined) {
    // Narrowed by the actor-kind check above: an edge with a role is always a reviewer edge.
    const role = actor.kind === 'reviewer' ? actor.role : undefined;
    if (role !== edge.requiredRole) {
      throw refuse(`it needs a reviewer with the role ${edge.requiredRole}, not ${String(role)}`);
    }
  }
  if (check.reason.trim() === '') throw refuse('every transition records a reason (R-B20)');
  if (edge.requiresRulesetVersion === true && (check.rulesetVersion ?? '') === '') {
    throw refuse('it has to name the ruleset version that decided (R-B8)');
  }
  if (edge.refusesAbsoluteReject === true) {
    const matched = check.matched;
    if (matched === undefined || matched === null) {
      throw refuse('the intake has no stored evaluation, so nobody can say what the rules found');
    }
    if (blocksApproval(matched, check.absoluteRejects)) {
      throw refuse(
        `the rules rejected it absolutely (${matched.join(', ')}), ` +
          'which a reviewer cannot resolve in the patient\u2019s favour (Q1)',
      );
    }
  }
  return edge;
}

/**
 * The intake state an engine outcome becomes at submit. Total over the three outcomes that can
 * occur, and loud on the fourth: the form makes every input the rules need mandatory and the
 * server re-validates them, so `not_evaluable` at submit would mean the form's validation and the
 * engine's contract had drifted apart — a bug to surface, not a state to store (ADR-0014 item 8).
 */
export function stateForOutcome(outcome: string): IntakeState {
  switch (outcome) {
    case 'auto_cleared':
    case 'auto_flagged':
    case 'auto_rejected':
      return outcome;
    default:
      throw new Error(
        `the engine returned ${outcome} for a submitted intake; the form must validate every ` +
          'input the rules need before submit (ADR-0014 item 8)',
      );
  }
}
