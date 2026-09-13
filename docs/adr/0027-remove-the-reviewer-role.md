# ADR-0027: Remove the reviewer role

- **Status:** proposed
- **Date:** 2026-09-13
- **Deciders:** Andrei Andreev
- **Requirements:** R-B15, R-B16, R-B20, R-T4, R-S4 · **Relates to:** Q8 (reviewer identity) ·
  **Amends:** ADR-0014 item 3 (the role half of it; the age carve-out stands), ADR-0021 (the
  sentences about what the gate protects)

## Context and problem statement

`reviewers.role` is `doctor` | `ops`, and ADR-0014 item 3 gates two edges on it: only a `doctor`
may take `in_review → approved` or `in_review → rejected`. It reads like an authorisation control
over the one genuinely clinical decision in the product.

It is not one, and ADR-0021 says so in its own words: the console has **one shared secret for the
whole team**, and the reviewer then **picks their own name from a list**. Anyone who can reach the
login page can choose `Dr Vermeer` and take both edges. The gate refuses nobody who wants to pass
it; it only inconveniences a colleague who picked their own name honestly.

So the role costs a `pgEnum`, a `not null` column, a field on `TransitionActor`, a field on
`TransitionEdge`, a branch in `checkTransition`, a field on the session's reviewer, a shape in the
`REVIEWERS` environment variable, a conditional in the intake screen, and a `403` contract — and it
buys a guarantee the same repo documents as absent.

## Decision drivers

- **A control that cannot refuse anybody is worse than no control**: it invites a reader to believe
  the medical decision is protected when the README already explains that it is not.
- YAGNI, and the brief's own measure: "Deterministic and explainable beats clever" (§3B). The
  assignment asks for role separation nowhere. R-B6's "clear for doctor review" names an engine
  outcome, not an access rule.
- **The safety property survives without it.** What actually closes an approval is
  `refusesAbsoluteReject` on edge 9 — Q1's absolute age reject. That is a property of the intake's
  stored evaluation, not of the person, so it refuses *every* reviewer, doctor included, and no
  choice at the login page moves it.
- Nothing in the audit depends on it: an entry records `actor`, `actor_reviewer_id`, from-state,
  to-state and reason (R-B20). Who a person is is recorded; what they were allowed to be is not.

## Considered options

1. **Remove the role entirely** — enum, column, edge field, gate, session field, env shape, UI.
2. **Keep the column, stop enforcing it.** A label on a reviewer, shown but deciding nothing.
3. **Keep it and make it real** — per-reviewer credentials, so the gate refuses somebody.

## Decision outcome

Chosen option: **1, remove it entirely**, because a gate that refuses nobody is a claim the product
cannot keep, and the clinical safety it appears to provide is provided by the age carve-out
instead.

Option 2 is the worst of the three: ADR-0014 item 3 already rejected it in a sentence that still
holds — "a seeded role that gates nothing would be decoration". Option 3 is the right answer for a
real deployment and is out of scope here: it needs per-reviewer credentials, which is the SSO
README already names as the thing a real deployment plugs in. **Removing the role does not decide
against roles; it declines to simulate them.** Reintroducing them belongs in the same change that
makes identity real, and that change has one seam — `currentReviewer()`.

### What changes

- `reviewer_role` (pgEnum) and `reviewers.role` are dropped, in a migration of their own.
- `TransitionEdge.requiredRole` and the `checkTransition` branch that reads it are removed. The
  ten edges and the two other guards — `requiresRulesetVersion`, `refusesAbsoluteReject` — are
  untouched, so the database trigger of `drizzle/0007` still mirrors the same table.
- `TransitionActor`'s reviewer variant loses `role`; it keeps `id` and `name`, which is what the
  audit entry records.
- `ConsoleReviewer` loses `role`. The session cookie never carried one (ADR-0021), so nothing about
  the signature or the `currentReviewer()` seam changes.
- The intake screen shows the same decision to every signed-in reviewer: no `isDoctor` prop, no
  "Approving and rejecting are a doctor's" caption. The queue header and the login list stop
  printing a role.
- `REVIEWERS` becomes an array of objects carrying a name: `[{"name":"Dr Vermeer"}, …]`. A leftover
  `"role"` key is **ignored rather than refused**, deliberately: the value is already set in a
  deployed environment, and a strict schema would take the whole app down on the first boot after
  this change rather than seed a reviewer without a role.

### Consequences

- Good: one concept fewer in the schema, the machine, the session, the env and two screens, and no
  sentence in the repo that overstates what the console enforces.
- Good: `403` stops being ambiguous. It now means one thing — the rules closed this approval (Q1) —
  where before it meant either that or "wrong role", which ADR-0026 already had to work around.
- Bad: two colleagues sharing the console can now both approve. Accepted: they could before, by
  picking the other name from the list, and the audit entry names whoever did it either way.
- Bad: an existing database has the column dropped, which is not reversible from the migration.
  The data is two labels on two seeded rows and is reproducible with `npm run seed:reviewers`.
- Neutral: `reviewer-day.md` keeps its two-person scenario. Ops work and clinical work are still
  different jobs done by different people; the app just stops pretending it can tell them apart.
  `console-stories.md` S-14 loses its doctor-only clause.

### Confirmation

- The migration drops the column and the enum, and `migrations.integration.test.ts` still passes.
- `machine.test.ts` asserts every reviewer edge is open to any reviewer, and the edge count stays
  ten, so `state-machine-lock.integration.test.ts` still matches the trigger.
- A test asserts approval is still refused for an intake whose evaluation matched
  `age_below_minimum`, with a `403`, for a reviewer who would previously have been a doctor.
- The transition route's integration test asserts both reviewers can approve and reject.
- `env.test.ts` asserts `REVIEWERS` parses without a role, and that a value still carrying one
  loads and is seeded without it.
- `grep -ri "reviewer_role\|requiredRole\|isDoctor" src drizzle` returns nothing.

## More information

- ADR-0014 (the state machine; item 3's age carve-out stands, its role half does not), ADR-0021
  (one shared secret, identity picked from a list — the reasoning this ADR rests on), ADR-0026
  (the 403/409 split this simplifies).
- `QUESTIONS.md` Q8 "Reviewer identity / authentication", default A: no authentication. The role
  was always a duty separation *inside* that default, never a control over it.
- `README.md` "Deliberate scope cuts" carries the replacement sentence.
