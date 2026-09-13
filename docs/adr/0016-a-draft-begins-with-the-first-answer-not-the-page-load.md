# ADR-0016: A draft begins with the first answer, not with the page load

- **Status:** accepted
- **Date:** 2026-09-13
- **Deciders:** Andrei Andreev
- **Requirements:** R-B1, R-B4, R-T4 ·
  **Amends:** ADR-0015 item 3 (`POST /api/intakes` takes the identity step and creates the draft
  from it) and ADR-0015 item 2 (the draft is created by the first step, not before it)

## Context and problem statement

ADR-0015 item 3 gave `POST /api/intakes` no body: the form created an empty draft on page load so
that every step had somewhere to be saved. Running the form by hand on `feature/intake-flow` showed
what that costs. The mount effect that creates the draft is aborted by its own cleanup, and the
`started` ref written to stop React's development double-invoke then blocks the second run, so the
only request is cancelled and `intakeId` is never set — `/intake` sits on "Starting your intake…"
forever in `next dev`. The abort does not reach the server, so the row is created anyway: the guard
broke the page without preventing the duplication it was written for, and the local compose
database collected four drafts from four page loads.

The bug is fixable in the effect. The question this ADR answers is whether the effect should exist
at all, because the same design makes every page view — a refresh, a crawler, a link preview — an
`intakes` row with no answers in it.

## Decision drivers

- A row is a claim about the world. An `intakes` row that no patient has answered a question in
  claims an intake that never happened — the same objection ADR-0015 raised against Option 2's
  nameless `patients` row, arriving one table over.
- KISS (`CLAUDE.md` §2): the effect needs a ref to survive React's double-invoke, an
  `AbortController` to survive unmount, and the two interact. Not having the effect needs neither.
- Validate once, at the boundary; the server stays the only authority (`CLAUDE.md` §2, R-T4).
- YAGNI: the draft has to exist before the *second* step is saved, not before the first is typed.

## Considered options

1. **Keep the mount effect and fix it** — drop the abort, or reset the ref in the cleanup, and let
   the server-side row stand.
2. **Create the draft on the patient's first action.** The first step's "Next" sends
   `POST /api/intakes` carrying the identity answers; the route creates the draft and saves step one
   in one transaction. Later steps `PATCH` as before.
3. **Keep the empty draft but expire it** — a scheduled job deletes drafts that were never answered.

## Decision outcome

Chosen option: **Option 2**. It removes the reason for the effect rather than repairing it: no mount
effect, no abort, no ref, and nothing to get wrong between them. A page view is not an intake, so a
bot or a refresh creates nothing, and the "abandoned draft" `intakes` row that ADR-0015 accepted as
a neutral consequence now only exists for someone who actually answered the first question.

Option 1 leaves every page load writing a row and keeps the effect's two interacting guards. Option
3 answers the symptom with a cleanup job the assignment does not need and Wellis would have to
operate.

### 1. `POST /api/intakes` takes the first step

The body is the identity step's answers — `{ fullName, email, dob }` — validated by the *same*
`stepSchemas(...).identity` that `PATCH` uses, so there is one definition of a valid first step and
the two routes cannot disagree. On success the route writes, in one transaction:

- one `intakes` row, `state` `draft`, `answers` `{ formVersion, identity }`, `outcome` `pending`,
  both history reports `not_answered` — edge 0 of ADR-0014, unchanged;
- the creation audit entry, actor `intake form`, unchanged.

`400` with the same issue list `PATCH` returns if the first step does not validate, and nothing is
written. `201` with the id and the stored answers otherwise. Every later step is `PATCH` exactly as
ADR-0015 item 3 specified.

### 2. The form has no mount effect

`IntakeForm` holds `intakeId` as before, starting `null`, and renders the first step immediately —
there is no "Starting your intake…" state, because nothing has to happen before the patient can
type. One branch in `advance()` decides the request: `intakeId === null` posts and takes the id from
the response, otherwise it patches. Pressing "Back" to step one and "Next" again patches, because
the id is set by then.

Re-entrancy is handled by the `busy` flag that already disables the buttons: React flushes the state
update from a discrete event before the next one is processed, so a double-click cannot start two
requests. This is the same mechanism every other step already relies on, not a new one.

### Consequences

- Good: `/intake` works in `next dev`, which it did not before.
- Good: a page view writes nothing. The only writer of an `intakes` row in the new flow is a patient
  who answered the first question.
- Good: three fewer moving parts in the client (effect, ref, `AbortController`) and one fewer
  rendering state.
- Bad: `POST /api/intakes` now does two things — create and save step one. Accepted: they are one
  transaction and one fact ("this patient started an intake"), and splitting them is what caused
  this.
- Bad: a patient who abandons the form after step one still leaves a draft row. Unchanged from
  ADR-0015's neutral note; the volume is now bounded by people who typed a name rather than by page
  views.
- Neutral: if the request fails, the patient sees the failure on the form with their answers still
  in the fields, and pressing "Next" again retries. Previously a failure replaced the whole page.

### Confirmation

- Integration test: rendering `/intake` creates no `intakes` row; the first step's `POST` creates
  exactly one, with `answers.identity` stored and the creation audit entry written.
- Integration test: a `POST` whose identity answers fail validation, and one whose body is not JSON,
  are `400` and leave `intakes` empty.
- Integration test: the existing `PATCH`, submit and `GET` cases still pass with the draft created
  from step one.
- By hand in `next dev`: the five steps, end to end, on the branch before the commit.

## More information

- ADR-0014 edge 0 (creation), ADR-0015 items 2 and 3 (the form's steps and the API).
- `REQUIREMENTS.md` R-B1 (multi-step), R-B4 (plain), R-T4 (the server is the authority).
