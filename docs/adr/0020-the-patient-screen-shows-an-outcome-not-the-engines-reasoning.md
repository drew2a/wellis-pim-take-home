# ADR-0020: The patient's screen shows an outcome, not the engine's reasoning

- **Status:** proposed
- **Date:** 2026-09-13
- **Deciders:** Andrei Andreev
- **Requirements:** R-B8, R-B9, R-B12, R-S4 · **Relates to:** ADR-0010 (the engine's reasons),
  ADR-0015 item 5 (what `POST …/submit` answers)

## Context and problem statement

The screen a patient reaches after submitting showed three things the engine produced for a
reviewer: the explanation lines verbatim ("flagged: BMI 27.0 with no weight-related condition"),
the ruleset version that judged them, and — until the review of `feature/ui-baseline` — the intake
state as a coloured badge. The consent step likewise printed "Consent text version v3."

Those lines are correct and they are the wrong audience. "rejected: BMI 22.1 below 27" is a
sentence written to be *auditable*, not to be read by the person it is about, and `auto_flagged`
under a reassuring headline reads as a verdict where the system has in fact deferred to a human.
A patient who is flagged is not yet anything; a patient who is rejected deserves the news from the
care team, in the care team's words, not from a rules engine's log line.

## Decision drivers

- R-B9 binds the **outcome**, not the screen: every outcome must *carry* a human-readable
  explanation naming the triggering values. It says nothing about who is shown it, and the reviewer
  is the reader it exists for.
- R-B8 likewise requires the ruleset version to be **stored on the intake**, which it is.
- A medical result is communicated by the clinic, not published by the form (ASSIGNMENT.md §3B:
  a doctor makes the final decision).
- Machine vocabulary stays in machine surfaces (`CLAUDE.md` §6: *outcome* and *status* are our
  words, not the patient's).

## Considered options

1. **Show everything** the engine produced — the state, the reasons, the version.
2. **Show the outcome in the clinic's words**, and nothing the engine wrote.
3. **Translate each reason** into patient-facing prose.

## Decision outcome

Chosen option: **Option 2**.

Option 1 is the present state and the problem. Option 3 is a second vocabulary for every rule,
maintained in step with `rules/v1.json` and wrong the first time the two drift — a translation
layer between a patient and a medical decision is exactly the place a silent divergence does harm,
and the assignment asks for deterministic and explainable, not for more moving parts.

### 1. What the result screen says

One headline per state, already written for a patient, plus the sentence that a doctor makes the
final decision. No reason lines, no ruleset version, no state badge (the badge went in the review
of `feature/ui-baseline`).

### 2. What the consent step says

The statement and the agreement. The version label is dropped: `CONSENT_TEXT_VERSION` is how *we*
identify which text was agreed to, and it is stored on the consent event either way (ADR-0015
item 4). It is not information a patient can act on.

### 3. What is unchanged

Everything that is recorded. The evaluation still stores its reasons and its `ruleset_version`, the
intake still stores the version that judged it, and the audit log still records every transition.
R-B8 and R-B9 are satisfied where they are written — in the data, for the reviewer.

### Consequences

- Good: nothing on a patient-facing screen invites self-diagnosis from a rule's wording.
- Good: one vocabulary for rules, not two.
- Bad: a rejected patient is told less than the system knows. That is the intended trade, and the
  headline says a person will be in touch.
- Neutral: the review console is now the only place the reasons are read, which is what it is for.

### Open follow-up, not decided here

`POST /api/intakes/:id/submit` still **answers** with `reasons` and `rulesetVersion`, and the
intake's uuid is the only credential (ADR-0015 item 3), so a patient who opens the network tab can
read what the screen no longer shows. Hiding it in the client is therefore a product decision, not
a disclosure boundary. Narrowing the response — or keeping the full one for a reviewer-authenticated
read and trimming the patient's — changes the contract `GET /api/intakes/:id` and the console will
rely on, so it is recorded here and left to the repo owner.

### Confirmation

- The rendered result screen contains no line from `evaluation.reasons` and no ruleset version.
- The integration tests are unchanged: the submit response still carries both, and the evaluation
  row still stores them.

## More information

- ADR-0010 (precedence and reason strings), ADR-0015 items 4 and 5, `REQUIREMENTS.md` R-B8, R-B9.
- The review of `feature/ui-baseline`, which removed the state badge from the same screen for the
  same reason.
