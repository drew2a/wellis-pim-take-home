// The state machine of ADR-0014, exhaustively: every one of the 144 ordered state pairs is either
// one of the 10 legal edges or refused. A grid rather than a list of cases, because R-B15 is about
// what is *impossible*, and a hand-picked list of illegal transitions only proves the ones someone
// thought of.
import { describe, expect, it } from 'vitest';

import type { MatchedRule } from '@/eligibility/types';
import { loadRules } from '@/rules/load';

import {
  blocksApproval,
  checkTransition,
  edgeFor,
  IllegalTransitionError,
  INTAKE_STATES,
  isLegacyState,
  stateForOutcome,
  TRANSITIONS,
  type IntakeState,
  type TransitionActor,
} from './machine';

const rules = loadRules();

// Two reviewers, not two roles: since ADR-0027 a reviewer is a name, and every reviewer edge is
// open to every one of them. They stay as two so the tests below can say "either of them".
const VERMEER: TransitionActor = {
  kind: 'reviewer',
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Dr Vermeer',
};
const BAKKER: TransitionActor = { ...VERMEER, name: 'Sanne Bakker' };
const FORM: TransitionActor = { kind: 'process', name: 'intake form' };
const ENGINE: TransitionActor = { kind: 'process', name: 'eligibility engine' };

const pairs: [IntakeState, IntakeState][] = INTAKE_STATES.flatMap((from) =>
  INTAKE_STATES.map((to): [IntakeState, IntakeState] => [from, to]),
);

/** An actor that satisfies the edge, so only the pair itself is under test. */
function actorFor(from: IntakeState, to: IntakeState): TransitionActor {
  const edge = edgeFor(from, to);
  if (edge?.actorKind !== 'reviewer') return from === 'submitted' ? ENGINE : FORM;
  return VERMEER;
}

function check(from: IntakeState, to: IntakeState): void {
  const edge = edgeFor(from, to);
  checkTransition({
    from,
    to,
    actor: actorFor(from, to),
    reason: 'because the test says so',
    rulesetVersion: edge?.requiresRulesetVersion === true ? 'v1' : null,
    matched: [],
    absoluteRejects: rules.precedence.absolute_rejects,
  });
}

describe('the transition table', () => {
  it('has the ten edges of ADR-0014 and no others', () => {
    expect(TRANSITIONS.map((edge) => `${edge.from} -> ${edge.to}`)).toEqual([
      'draft -> submitted',
      'submitted -> auto_cleared',
      'submitted -> auto_flagged',
      'submitted -> auto_rejected',
      'auto_cleared -> in_review',
      'auto_flagged -> in_review',
      'auto_rejected -> in_review',
      'legacy_pending -> in_review',
      'in_review -> approved',
      'in_review -> rejected',
    ]);
  });

  it('covers all 144 ordered pairs, accepting 10 and refusing 134', () => {
    const accepted = pairs.filter(([from, to]) => edgeFor(from, to) !== undefined);
    expect(pairs).toHaveLength(144);
    expect(accepted).toHaveLength(10);
    expect(pairs.length - accepted.length).toBe(134);
  });

  it.each(pairs)('%s -> %s behaves as the table says', (from, to) => {
    if (edgeFor(from, to) === undefined) {
      expect(() => {
        check(from, to);
      }).toThrow(IllegalTransitionError);
    } else {
      expect(() => {
        check(from, to);
      }).not.toThrow();
    }
  });

  it('refuses a transition to the state the intake is already in', () => {
    for (const state of INTAKE_STATES) {
      expect(edgeFor(state, state)).toBeUndefined();
    }
  });

  it('is acyclic: no state that can be left is ever entered again', () => {
    const entered = new Set(TRANSITIONS.map((edge) => edge.to));
    const path: IntakeState[] = ['draft', 'submitted', 'auto_flagged', 'in_review', 'approved'];
    for (const [index, state] of path.entries()) {
      const predecessors = TRANSITIONS.filter((edge) => edge.to === state).map((edge) => edge.from);
      expect(predecessors).not.toContain(path[index]);
    }
    expect(entered.has('draft')).toBe(false);
  });

  it('knows which states are legacy and outside the machine', () => {
    expect(INTAKE_STATES.filter(isLegacyState)).toEqual([
      'legacy_approved',
      'legacy_rejected',
      'legacy_pending',
      'legacy_expired',
    ]);
  });

  it('lets a legacy intake in only through legacy_pending, and never lets one back out', () => {
    const crossings = TRANSITIONS.filter((edge) => isLegacyState(edge.from));
    expect(crossings.map((edge) => `${edge.from} -> ${edge.to}`)).toEqual([
      'legacy_pending -> in_review',
    ]);
    expect(TRANSITIONS.filter((edge) => isLegacyState(edge.to))).toEqual([]);
  });
});

describe('who may take an edge', () => {
  const base = {
    reason: 'because the test says so',
    matched: [] as MatchedRule[],
    absoluteRejects: rules.precedence.absolute_rejects,
  };

  it('refuses a process edge taken by a reviewer', () => {
    expect(() =>
      checkTransition({ ...base, from: 'draft', to: 'submitted', actor: VERMEER }),
    ).toThrow(/reviewer/i);
  });

  it('refuses a reviewer edge taken by a process', () => {
    expect(() =>
      checkTransition({ ...base, from: 'auto_flagged', to: 'in_review', actor: ENGINE }),
    ).toThrow(/process/i);
  });

  // ADR-0027: the medical decision is open to any reviewer. What closes an approval is the
  // intake's own evaluation — asserted under "what an edge demands" — and that refuses everybody
  // alike, which is the property the role gate was mistaken for.
  it.each([['approved' as const], ['rejected' as const]])(
    'lets any reviewer take in_review -> %s',
    (to) => {
      for (const actor of [VERMEER, BAKKER]) {
        expect(() => checkTransition({ ...base, from: 'in_review', to, actor })).not.toThrow();
      }
    },
  );

  it.each([
    ['auto_cleared' as const],
    ['auto_flagged' as const],
    ['auto_rejected' as const],
    ['legacy_pending' as const],
  ])('lets any reviewer claim from %s', (from) => {
    for (const actor of [VERMEER, BAKKER]) {
      expect(() => checkTransition({ ...base, from, to: 'in_review', actor })).not.toThrow();
    }
  });

  // The one thing no reviewer may do, and the reason the role gate was not load-bearing.
  it('refuses an approval the rules rejected absolutely, whoever asks', () => {
    for (const actor of [VERMEER, BAKKER]) {
      expect(() =>
        checkTransition({
          ...base,
          from: 'in_review',
          to: 'approved',
          actor,
          matched: ['age_below_minimum'],
        }),
      ).toThrow(/absolutely/i);
    }
  });
});

describe('what an edge demands', () => {
  const base = {
    actor: ENGINE,
    matched: [] as MatchedRule[],
    absoluteRejects: rules.precedence.absolute_rejects,
  };

  it('refuses an empty reason', () => {
    expect(() =>
      checkTransition({
        ...base,
        from: 'submitted',
        to: 'auto_cleared',
        reason: '   ',
        rulesetVersion: 'v1',
      }),
    ).toThrow(/reason/i);
  });

  it('refuses the engine’s edges without the ruleset that decided', () => {
    expect(() =>
      checkTransition({
        ...base,
        from: 'submitted',
        to: 'auto_flagged',
        reason: 'flagged',
        rulesetVersion: null,
      }),
    ).toThrow(/ruleset/i);
  });
});

// Q1 makes the age rule an absolute reject precisely because a reviewer cannot resolve it in the
// patient's favour. The guard is the pure half; fetching the evaluation is the caller's job.
describe('the age carve-out (Q1)', () => {
  const absoluteRejects = rules.precedence.absolute_rejects;
  const base = { actor: VERMEER, reason: 'looks fine to me', absoluteRejects };

  it('names age_below_minimum as the absolute reject of ruleset v1', () => {
    expect(absoluteRejects).toEqual(['age_below_minimum']);
  });

  it('blocks approval when an absolute reject fired, and not otherwise', () => {
    expect(blocksApproval(['age_below_minimum'], absoluteRejects)).toBe(true);
    expect(blocksApproval(['bmi_below_minimum', 'glp1_medication'], absoluteRejects)).toBe(false);
    expect(blocksApproval([], absoluteRejects)).toBe(false);
  });

  it('refuses in_review -> approved for an under-age intake', () => {
    expect(() =>
      checkTransition({
        ...base,
        from: 'in_review',
        to: 'approved',
        matched: ['age_below_minimum'],
      }),
    ).toThrow(/age/i);
  });

  it('still allows in_review -> rejected for the same intake', () => {
    expect(() =>
      checkTransition({
        ...base,
        from: 'in_review',
        to: 'rejected',
        matched: ['age_below_minimum'],
      }),
    ).not.toThrow();
  });

  it('refuses approval when there is no evaluation to judge by', () => {
    expect(() =>
      checkTransition({ ...base, from: 'in_review', to: 'approved', matched: null }),
    ).toThrow(/no stored evaluation/i);
  });

  it('does not ask for an evaluation on any other edge', () => {
    expect(() =>
      checkTransition({ ...base, from: 'in_review', to: 'rejected', matched: null }),
    ).not.toThrow();
  });
});

describe('the outcome an engine verdict becomes (ADR-0014 item 8)', () => {
  it.each([['auto_cleared'], ['auto_flagged'], ['auto_rejected']])(
    'maps %s to itself',
    (outcome) => {
      expect(stateForOutcome(outcome)).toBe(outcome);
    },
  );

  it('throws on not_evaluable rather than inventing a state for it', () => {
    expect(() => stateForOutcome('not_evaluable')).toThrow(/not_evaluable/);
  });
});
