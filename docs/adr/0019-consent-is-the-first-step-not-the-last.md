# ADR-0019: Consent is the first step of the intake form, not the last

- **Status:** accepted
- **Date:** 2026-09-13
- **Deciders:** Andrei Andreev
- **Requirements:** R-B1, R-B2, R-B4, R-B7, R-T4 · **Amends:** ADR-0015 item 2 (the step table:
  consent was step 5) and item 3 (`POST /api/intakes` carries the identity step) ·
  **Amends:** ADR-0016 item 1 (the first step, and therefore the body of `POST /api/intakes`, is
  the identity step)

## Context and problem statement

The five-step form asks for a name, a date of birth, a height and a weight, a medication list and
a set of diagnoses, and *then* asks the patient to agree that Wellis may process exactly that data.
By the time the question is put, every answer it is about has already been typed, sent to the
server and stored in `intakes.answers` — on a draft that survives whether or not the patient ever
reaches step five.

That is the wrong order for a permission. A patient who reads the statement and declines has
already handed over their date of birth, their weight and their diagnoses, and the only thing their
refusal prevents is the submission. ADR-0015 item 4 built the consent gate to be strict about
*form* — an explicit grant carrying the version of the text that was shown — and then placed it
where it gates the least.

## Decision drivers

- Consent is permission to process, so it is asked before the processing, not after it
  (`CLAUDE.md` §5: identity, medicine and consent are the things that never resolve loosely).
- A draft nobody finished should hold as little as possible. ADR-0016 already refused to write a
  row for a page load; the same reasoning applies to the answers a refusal leaves behind.
- Deterministic and explainable (ASSIGNMENT.md §3B): "the first step creates the draft" must stay
  one sentence with one meaning, in the route and in the form.
- YAGNI: this is a reordering, not a new mechanism. No new table, column, or endpoint.

## Considered options

1. **Keep consent last** and accept that health data is collected before permission is given.
2. **Consent first** — it becomes step one and the step that creates the draft.
3. **Consent twice** — a short notice up front and the binding grant at the end.

## Decision outcome

Chosen option: **Option 2**.

Option 1 is the present state and the problem. Option 3 is two consent artefacts where the schema
has one: `ConsentAnswers` holds a single grant and one `textVersion`, and a second, non-binding
notice would be a thing shown to the patient that no record can prove was shown — worse than
either honest order, and more machinery than a seven-day assignment earns.

### 1. The order

`INTAKE_STEPS` becomes `consent, identity, metrics, medications, conditions`. The form derives its
own order from that constant rather than repeating it, so the list a reader finds in
`src/intake/answers.ts` is the order the patient walks through, and the two cannot drift. The last
step — conditions — carries the "Submit" button.

### 2. `POST /api/intakes` carries the consent step

The body of the create request is the consent step's answers, `{ granted, textVersion }`, validated
by the same `stepSchemas(...).consent` that `PATCH` uses. Everything else about the route is
unchanged from ADR-0016 item 1: one `intakes` row in `draft`, `outcome` `pending`, the two reports
`not_answered`, the creation audit entry, and `400` with the same issue list if the step does not
validate.

Because `consentSchema` requires `granted` to be literally `true`, a patient who does not agree
cannot create a draft at all: the request is refused and **nothing is written** — no row, no audit
entry, no answers. The consent gate at submit (ADR-0015 item 4) is unchanged and still runs; it is
now a second check of something already established rather than the first.

### 3. What an abandoned draft contains

A draft abandoned after step one holds `{ formVersion, consent: { granted: true, textVersion } }`
and nothing else: no name, no email, no date of birth, no weight, no diagnoses. Under the old
order, a draft abandoned at the same point in the patient's attention — one step in — held their
full identity. This is the point of the change.

### 4. When consent was given, and when it is recorded

The `consent_events` row is still written at submit, with `at` the submission instant
(ADR-0015 item 4, unchanged). Nothing else is possible: the event references a patient, and the
patient is created at submit. The agreement is therefore *recorded* later than it was *given*, by
the length of one form-filling session.

That gap is evidenced, not lost. The creation audit entry — `actor` `intake form`, `from_state`
null, `to_state` `draft` — is written in the same transaction as the consent step, so its `at` is
the instant the patient agreed, and the audit log is append-only (`CLAUDE.md` §5). A draft that is
never submitted produces no `consent_events` row, which is correct: there is no patient whose
`consent_state` it could be part of, and the log is evidence about patients we hold data on.

### 5. What the patient is agreeing to, before being asked

Asking first is only honest if the statement says what will be asked. `CONSENT_TEXT` already
enumerates the categories by name — "my date of birth, height, weight, medication use and medical
conditions" — so the agreement is informed even though the questions follow it. Any future edit
that removes that enumeration would make this order wrong; the sentence is load-bearing, not
decorative.

The text itself does not change and `CONSENT_TEXT_VERSION` stays `v3`: the same words in a
different position are the same agreement, and nobody has yet agreed to `v3`.

### Consequences

- Good: no health data reaches the server before permission to process it exists.
- Good: an abandoned draft holds no personal data.
- Good: refusal costs the patient one screen instead of five.
- Bad: the patient agrees before seeing the questions. Mitigated by item 5, and the alternative is
  agreeing after already answering them.
- Neutral: the submit-time consent gate is now redundant in the happy path. It stays — it is the
  server's own check that a submission is consented (R-T4), and a draft's answers are patchable.

### Confirmation

- Unit test: `INTAKE_STEPS[0]` is `consent`, so the form's order and the create route's step cannot
  disagree silently.
- Integration test: `POST /api/intakes` with the consent answers creates the draft with
  `answers.consent` stored and the creation audit entry written.
- Integration test: `POST /api/intakes` with `granted: false`, and with a stale `textVersion`, both
  return `400` and leave `intakes` and `audit_entries` empty.

## More information

- ADR-0015 items 2, 3 and 4 (the step table, the create route, the consent gate), ADR-0016 item 1
  (a draft begins with the first answer), ADR-0007 (`consent_events.at` is an instant).
- `src/consent/text.ts`, `src/intake/answers.ts` (`INTAKE_STEPS`, `consentSchema`).
