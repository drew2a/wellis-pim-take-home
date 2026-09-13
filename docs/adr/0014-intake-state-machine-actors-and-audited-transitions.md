# ADR-0014: The intake state machine: edges, actors, audited transitions and the database lock

- **Status:** proposed
- **Date:** 2026-09-13
- **Deciders:** Andrei Andreev
- **Requirements:** R-B6, R-B7, R-B13, R-B14, R-B15, R-B16, R-B17, R-B18, R-B19, R-B20, R-B21,
  R-T4 · **Resolves:** Q8 (default A) · **Enforces:** Q1's age carve-out, at the transition ·
  **Amends:** ADR-0009 item 4 (the two Part B system actors), ADR-0004 (`audit_entries` gains
  `seq`, `ruleset_version`, `actor_reviewer_id`)

## Context and problem statement

Part B says an intake moves through `draft → submitted → (auto_cleared | auto_flagged |
auto_rejected) → in_review → (approved | rejected)`, that illegal transitions must be
*structurally* impossible rather than merely avoided, and that every state change carries actor,
timestamp, from-state, to-state and reason (§3B, R-B13–R-B20). The schema already has the
`intake_state` enum (ADR-0004) and an append-only `audit_entries` table (ADR-0007), and the
importer already parks legacy intakes in four terminal `legacy_*` states outside the machine
(ADR-0005). What no accepted ADR states is the edge set itself, who may take each edge, where
"impossible" is enforced, and how a legacy intake a reviewer opens today relates to the machine.
The intake flow cannot be written without those answers, and the console branch would otherwise
invent its own.

## Decision drivers

- Illegal transitions structurally impossible, enforced where a client cannot reach around it
  (R-B15, R-B16); the client carries no business rules (`CLAUDE.md` §2).
- One writer, one audit entry, no path that changes `intakes.state` without one (R-B18, R-B20).
- Deterministic and explainable beats clever (§3B): a table of edges a reviewer can read,
  not a framework.
- Audit is append-only and names an actor that is either a human identity or a named process
  (`CLAUDE.md` §5, ADR-0009 item 4).
- YAGNI: the minimum edge set of R-B13 plus the one crossing the export forces, nothing else.

## Considered options

1. **A pure edge table in TypeScript, one transition function that writes the audit entry, and a
   database trigger that mirrors the same table.** Two locks, one source of truth in the repo,
   one exhaustive test that drives the database from the TypeScript table so the two cannot drift.
2. **TypeScript only.** The transition function is the only writer by convention.
3. **Database only.** A `intake_transitions` reference table plus a trigger; the API just updates
   `intakes.state` and the database refuses illegal pairs.

## Decision outcome

Chosen option: **Option 1**. Option 2 fails R-B16 as written — "structurally prevented, not merely
avoided by convention" is exactly what a single application-level check is — and one forgotten
`db.update(intakes)` anywhere in the console branch would be a silent hole. Option 3 cannot
enforce *who* may take an edge (the trigger sees the row, never the actor) and cannot write the
audit entry in the same breath as the state change. Option 1 keeps the machine pure and testable
without a database (`CLAUDE.md` §2), and makes the database the second lock that holds even for a
hand-written `UPDATE`.

### 1. The transition table

Twelve `intake_state` values, **ten legal ordered pairs**, plus creation. Every other pair is
illegal.

| # | from | to | actor kind | actor | extra guard | performed by |
|---|---|---|---|---|---|---|
| 0 | *(creation)* | `draft` | process | `intake form` | — | `POST /api/intakes` |
| 1 | `draft` | `submitted` | process | `intake form` | — | `POST /api/intakes/:id/submit` |
| 2 | `submitted` | `auto_cleared` | process | `eligibility engine` | — | the same request |
| 3 | `submitted` | `auto_flagged` | process | `eligibility engine` | — | the same request |
| 4 | `submitted` | `auto_rejected` | process | `eligibility engine` | — | the same request |
| 5 | `auto_cleared` | `in_review` | reviewer | the reviewer who claims it | — | console (Part C) |
| 6 | `auto_flagged` | `in_review` | reviewer | the reviewer who claims it | — | console (Part C) |
| 7 | `auto_rejected` | `in_review` | reviewer | the reviewer who claims it | — | console (Part C) |
| 8 | `legacy_pending` | `in_review` | reviewer | the reviewer who claims it | — | console (Part C) |
| 9 | `in_review` | `approved` | reviewer | the deciding reviewer | role `doctor`; no absolute reject | console (Part C) |
| 10 | `in_review` | `rejected` | reviewer | the deciding reviewer | role `doctor` | console (Part C) |

The graph is acyclic: no state is entered twice, so no transition can legitimately repeat. Edges
5–10 are part of the machine and are implemented and tested on this branch; the routes that
*offer* them are the console's (out of scope here), which is why edge 8's `legacy_pending` intake
can be reached by test only until Part C lands.

Notes on the shape:

- **`auto_rejected → in_review` is legal.** The rules reject; a human may still look. R-B13 lists
  all three `auto_*` states as predecessors of `in_review`, and a patient rejected on a BMI of
  26.9 is exactly the case a care team wants to be able to open.
- **`auto_cleared` is not an approval.** §3B's wording is "clear for doctor review": a cleared
  intake still needs edge 5 and a human decision, which is why `approved` is reachable only
  through `in_review`.
- **Terminal:** `approved`, `rejected`, and the four `legacy_*` states except `legacy_pending`.
  **Transient:** `draft`, `submitted`, `in_review`. **Waiting for a human:** the three `auto_*`.
- **`legacy_expired` is unreachable**: no legacy `outcome` spelling maps to it (ADR-0005, the
  mapper's `STATE_FOR_OUTCOME`). It stays in the enum as declared by ADR-0004 and takes no edge.
- **Saving a draft step is not a transition.** It updates the draft's answers, the state stays
  `draft`, and it writes no audit entry: R-B18 audits *state changes*, and an audit entry per
  keystroke would bury the eleven that matter. What the patient finally submitted is kept
  verbatim (ADR-0015).
- **A second claim of the same intake fails.** `in_review → in_review` is not an edge, so the
  first reviewer to take edge 5–8 wins and the second gets an `IllegalTransitionError`. Exclusive
  claiming falls out of the machine; no `claimed_by` column is introduced for it on this branch.

### 2. Entering `in_review`: only ever a human, never on submit

An intake enters `in_review` when **a reviewer opens or claims it**, and the audit entry names
that reviewer. Nothing moves an intake into `in_review` automatically — not the engine, not a
cron, not the act of appearing in the work queue. The three `auto_*` states *are* the queue;
`in_review` means a named person has it.

This is what makes the audit answer "who looked at this, and when" instead of "it was in review
since Tuesday". It also keeps the queue honest: an intake nobody claimed is visibly unclaimed.

### 3. Which transitions a human may take, and which only a process

Every edge declares exactly one permitted **actor kind**, and the transition function rejects an
edge taken by the wrong kind as firmly as it rejects an edge that does not exist:

- **Process only** (edges 0–4): creating a draft, submitting it, and applying the engine's verdict.
  A human cannot hand-place an intake in `auto_cleared`; that state means *the rules said so*.
- **Reviewer only** (edges 5–10): claiming, approving, rejecting. The engine never approves and
  never rejects — `approved` and `rejected` are medical decisions by a person (§3B, R-B19).

Two edges carry a further guard, declared in the same table and refused the same loud way:

- **Role.** Edges 9 and 10 — the medical decision — require the reviewer's role to be `doctor`.
  Claiming (edges 5–8) and every review-item action are open to any reviewer: triaging the queue,
  resolving a conflict and merging two records are operational work, while approving or rejecting
  a course of treatment is not. A seeded role that gates nothing would be decoration; this is the
  one place it decides something.
- **The age carve-out.** Edge 9 is refused when the intake's stored evaluation has
  `age_below_minimum` in `matched`. `QUESTIONS.md` Q1 makes the age rule an *absolute* reject
  precisely because it is a legal gate a reviewer cannot resolve in the patient's favour
  (`rules/v1.json`, `precedence.absolute_rejects`); leaving `in_review → approved` open to
  everyone would have let a click undo the one rule the ruleset calls absolute. `rejected` and
  staying in `in_review` remain available, so the reviewer still has a decision to make — just
  not that one. The guard reads the intake's **governing evaluation**: the one with the latest
  `evaluated_at`, non-shadow first on a tie, which is the submission's own evaluation for a new
  intake and the current ruleset's shadow evaluation for a legacy one. An intake in `in_review`
  with no stored evaluation at all cannot be judged, so approving it **throws** rather than
  failing open (`CLAUDE.md` §2). The guard reads `eligibility_evaluations.matched`, the column
  ADR-0015 adds, which is why a database seeded before that migration must be re-imported before
  the guard means anything.

### 4. The actor model

| kind | who | recorded as |
|---|---|---|
| process | one of `SYSTEM_ACTORS` | `audit_entries.actor` = the process name, `actor_reviewer_id` null, `dedupe_key` deterministic (ADR-0008) |
| reviewer | a row in the new `reviewers` table, carrying their id, name and role | `audit_entries.actor` = the reviewer's name **as it was at the time**, `actor_reviewer_id` = their id, `dedupe_key` null |

- `SYSTEM_ACTORS` (ADR-0009 item 4) gains exactly two members, and nowhere else:
  **`intake form`** (accepts a submission) and **`eligibility engine`** (applies the verdict).
  They are named apart because they answer different questions: *the patient sent this* versus
  *the rules decided this*. There is no patient authentication, so `intake form` is the most the
  audit can truthfully name for edges 0 and 1; that is stated, not hidden.
- **`reviewers`**: `id uuid pk`, `name text not null unique`, `role reviewer_role not null`
  (`doctor` | `ops`), `created_at`. Seeded from a `REVIEWERS` environment variable (a JSON array
  of `{name, role}`) validated by Zod in `src/env.ts` and applied by `npm run seed:reviewers`,
  which upserts by name. **No SSO, no login, no sessions** — Q8 default A, recorded as a
  deliberate scope cut in `README.md` (R-S4). The role is enforced on this branch, on exactly the
  two edges item 3 names; the honest limit is that without authentication the caller *asserts*
  which reviewer they are, so the role separates duties, it does not resist an attacker.
- The reviewer's name is copied onto the audit entry rather than joined at read time: the entry is
  evidence and must still say who decided after the person is renamed or removed. `actor_reviewer_id`
  is the stable identity Q8 asks for so that real authentication slots in later.
- The split of ADR-0008 holds: a process entry carries a deterministic `dedupe_key`, a reviewer
  entry carries none, because each human decision is a new event (ADR-0012 item 1).

### 5. One function performs every transition

`transitionIntake(db, request)` in `src/intake/transition.ts` is the **only** code that writes
`intakes.state`, and it is the only code that writes an `audit_entries` row for an intake
transition. The edge table, the actor kinds, the required roles and the validation are a pure,
I/O-free module (`src/intake/machine.ts`) callable from a test without a database
(`CLAUDE.md` §2). The age guard is declared there too — as a property of edge 9 and as a pure
predicate over a `matched` list — and only the *fetch* of the governing evaluation lives in the
transition function, so the rule itself is still testable without a database.

In one transaction it: locks the intake (`select … for update`), reads `from`, refuses unless
`(from, to)` is in the table **and** the actor's kind matches the edge **and** the actor's role
satisfies the edge **and** the edge's guard passes **and** the reason is non-empty, updates
`intakes.state`, and inserts the audit entry with `actor`, `at`, `from_state`, `to_state`,
`reason`, `ruleset_version` and the optional `review_item_id` / `changes`. It throws
`IllegalTransitionError` before any write, so an illegal edge leaves the database untouched.
Every refusal is the same error and the same loudness: a missing edge, the wrong actor kind, the
wrong role and a blocked approval are all "this transition does not exist for you".

- **The reason is mandatory and is the human's note** where a human takes the edge (R-C6, R-C8).
  For edges 2–4 it is the engine's own explanation lines joined verbatim, so the timeline explains
  itself without joining to the evaluation (R-B9).
- **`ruleset_version` is required on edges 2–4** and optional elsewhere: the audit entry has to
  say which rules produced the verdict (R-B8), and a reviewer's decision may name the ruleset
  they were shown.
- **`audit_entries.seq`** (`bigint`, generated always as identity, unique) is added: a submit
  writes three entries in one transaction and `at` defaults to `now()`, which is the transaction
  timestamp and therefore identical for all three. That is true — one transaction is one instant —
  but the console still has to render them in order, and `seq` is that order. Nothing is
  re-ordered or rewritten; the table stays append-only.

### 6. The database is the second lock

One trigger, `intakes_state_machine`, `BEFORE INSERT OR UPDATE … FOR EACH ROW` on `intakes`,
holding for every role and every connection string (the argument of ADR-0007 for triggers over
privileges):

- **INSERT**: `state` must be `draft` (the new flow) or one of the four `legacy_*` states (the
  importer). An intake cannot be born `approved`.
- **UPDATE with `state` unchanged**: allowed — editing an intake's fields is not a transition.
- **UPDATE with `state` changed**: allowed only if the pair is one of the ten legal edges, or if
  **both** states are `legacy_*`. The second clause exists because a re-import may re-map a legacy
  `outcome` whose spelling it could not read before (`legacy_pending → legacy_approved`,
  ADR-0009 item 8), and legacy states are outside the machine (ADR-0005). Crossing *out* of the
  machine back to a legacy state is refused, as is any other pair.
- **UPDATE of `answers` when the state is not `draft`**: refused. What a patient submitted is the
  new flow's raw record and is evidence (ADR-0015, `CLAUDE.md` §5).

The trigger cannot see the actor, so actor-kind enforcement is the transition function's alone.
That is stated as a known limit: the database prevents an *illegal state*, the function prevents
an *illegal actor*, and every entry records which actor took the edge, so a wrong-kind transition
would be visible rather than silent.

### 7. How the `legacy_*` states relate to the machine

Legacy states are terminal and outside the machine (ADR-0005). They have exactly one door into it:
**`legacy_pending → in_review`**, taken by a reviewer, as a human transition — the one non-terminal
legacy state (ADR-0009 item 8), holding the intakes whose legacy outcome was `pending` or whose
spelling could not be read. Opening one is a person deciding to finish what the legacy process left
open, so the edge is a human transition and makes `state` human-owned, which is what stops a later
import from returning the intake to `legacy_pending` (ADR-0009 item 4).

`legacy_approved` and `legacy_rejected` have no door. The legacy process decided, and ADR-0005's
history audit already says what happens when today's rules disagree: a `clinical_history` review
item that asks whether the outcome should be revisited, never a rewritten outcome
(`CLAUDE.md` §5: detectors must not rewrite historical outcomes). Resolving such an item is a
human decision and is audit-logged (R-B19) as an entry with **both states null** — something
happened, but nothing transitioned.

### 8. `not_evaluable` at submit cannot happen, and is not handled as a state

The engine returns `not_evaluable` when an input a rule needs is missing (ADR-0010): no date of
birth, no weight, no height. The intake form makes all three mandatory and bounded (ADR-0015), the
server re-validates them at the boundary with Zod, and a submission missing any of them is a
**400 before the engine runs**. There is therefore no `auto_*` state for `not_evaluable`, and no
fourth state is invented for it.

The mapping from outcome to state is total over the three outcomes that can occur and **throws**
on `not_evaluable`: it would mean the form's validation and the engine's contract had drifted
apart, which is a bug to surface loudly, not a state to store (`CLAUDE.md` §2, "inside the server,
fail loudly"). Both halves are tested: the mapping function throws on `not_evaluable`, and an
incomplete submission is refused with 400 and writes nothing.

### Consequences

- Good: `intakes.state` has exactly one writer, every change of it has an audit entry, and the
  database refuses a change the machine does not allow even from `psql`.
- Good: the edge table is eleven rows of data. It can be read out loud in the follow-up, and the
  exhaustive test is a grid over all 144 ordered pairs rather than a list of cases someone chose.
- Good: `in_review` naming a person, plus the acyclic graph, gives exclusive claiming for free.
- Good: the one rule the ruleset calls absolute stays absolute all the way to the console. An
  under-age intake cannot be approved by anyone, and the refusal quotes the same `matched` list
  the patient's explanation was built from.
- Bad: the role gate and the age guard make the transition function read two things the trigger
  cannot see (the reviewer's role, the stored evaluation), so both are application-level only.
  Accepted: they restrict *who may do a legal transition*, while the trigger's job is that no
  illegal state exists at all.
- Bad: the age guard depends on a column (`eligibility_evaluations.matched`) whose historical
  rows the migration backfills with `[]`, so it fails open on a database that has not been
  re-imported since. Accepted and named here; production is seeded by a fresh import (R-T6).
- Bad: the edge set is written twice — TypeScript and the trigger's SQL. Mitigated, not removed:
  the integration test drives the database from the TypeScript table over every pair, so a
  divergence fails the build rather than reaching production.
- Bad: the trigger cannot enforce actor kind, and `session_replication_role = replica` disables
  it (which the test fixture uses to truncate). Accepted and documented; the fixture is the only
  code in the repo that does it (`src/test/database.ts`).
- Bad: `audit_entries` gains three columns, one of them (`seq`) purely for ordering. Accepted:
  without it the console cannot render a submit's three entries in the order they happened.
- Bad: three tables now hold a ruleset version for one intake (`intakes.ruleset_version`, the
  evaluation row, the audit entry). Accepted: the audit entry is evidence and must stand alone,
  and the three are written in one transaction from one value.
- Neutral: edges 5–10 have no route on this branch. They are implemented and tested; Part C adds
  the routes and the screens.
- Neutral: `reviewers` is a table a human seeds from the environment. It is not authentication and
  is not claimed to be (R-S4 scope cut).

### Confirmation

- Unit tests over the pure machine: all **144** ordered state pairs — 10 accepted, 134 refused
  (the 12 identity pairs included: moving to the state you are in is not a transition); every edge
  refused for the wrong actor kind; an empty reason refused; the age predicate refusing a
  `matched` list that holds `age_below_minimum` and passing one that does not.
- Integration tests, the role gate, both roles on both edges: a `doctor` takes
  `in_review → approved` and `in_review → rejected`; an `ops` reviewer is refused on both and
  writes nothing; both roles take a claim edge.
- Integration tests, the age carve-out: an intake whose stored evaluation matched
  `age_below_minimum` is refused `in_review → approved` and writes nothing, while
  `in_review → rejected` succeeds for the same intake; an intake in `in_review` with no stored
  evaluation throws on approval.
- Integration test, the full grid through `transitionIntake`: each of the 10 legal edges succeeds,
  writes exactly one audit entry with actor, from, to, reason and (edges 2–4) the ruleset version,
  and leaves the intake in the new state; each of the other 134 throws and leaves
  `intakes.state`, `audit_entries` and every other table unchanged.
- Integration test, the database lock, bypassing the application entirely with a direct `UPDATE`:
  the 10 legal edges are accepted, the **110** illegal non-identity, non-`legacy_*`-to-`legacy_*`
  pairs are rejected by the trigger, the 12 `legacy_*`-to-`legacy_*` pairs are accepted
  (item 6, second clause), and an `INSERT` in any state but `draft` or a `legacy_*` one is rejected.
- Integration test: an `UPDATE` of `answers` on an intake that is not `draft` is rejected.
- Unit test: the outcome-to-state mapping throws on `not_evaluable`.
- `SYSTEM_ACTORS` has exactly four members, and a test asserts the two Part B actors are in it.

## More information

- ASSIGNMENT.md §3B; `REQUIREMENTS.md` R-B13–R-B21; `QUESTIONS.md` Q8.
- ADR-0004 (`intake_state` enum, `audit_entries`), ADR-0005 (legacy states outside the machine,
  the history audit), ADR-0007 (append-only by trigger), ADR-0008 (dedupe keys under
  immutability), ADR-0009 item 4 (system actors) and item 8 (`legacy_pending`), ADR-0010
  (`not_evaluable`), ADR-0012 item 1 (a human entry has no dedupe key).
- ADR-0015 records what a submission does: the form's fields, the new-flow schema, the evaluation
  row, the consent gate and the identity detector.
