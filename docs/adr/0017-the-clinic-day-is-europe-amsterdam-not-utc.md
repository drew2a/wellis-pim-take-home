# ADR-0017: The day an intake is measured against is the clinic's day, not UTC

- **Status:** accepted
- **Date:** 2026-09-13
- **Deciders:** Andrei Andreev
- **Requirements:** R-B5, R-B6, R-B11, R-T4 · **Relates to:** Q4 (age is taken at submission) ·
  **Amends:** ADR-0010 (Q4's "age at submission" is the age on the clinic's calendar day)

## Context and problem statement

Every date rule in the new flow measures against "today": `identitySchema` refuses a date of birth
that is not in the past, `dobBounds` offers the days the field accepts, `eligibilityInputOf`
computes `ageYears`, and `submitIntake` stamps `patients.signup_date` and `intakes.submitted_at`.
Until now each of these took the **UTC** calendar day — `new Date().toISOString().slice(0, 10)`.

Wellis operates in the Netherlands, which is UTC+1 in winter and UTC+2 in summer. Between local
midnight and 01:00 or 02:00, the UTC day is still *yesterday*. A submission in that window is
therefore dated a day early, and the consequence is not cosmetic: a patient who turns 18 that day
is evaluated as 17, `age_below_minimum` fires, and `rules/v1.json` lists that rule under
`precedence.absolute_rejects`. `checkTransition`'s `refusesAbsoluteReject` then makes
`in_review → approved` permanently unreachable, and the answers-freeze trigger means the intake
cannot be corrected either. A one-hour clock error becomes a rejection no doctor can override.

## Decision drivers

- An eligibility boundary is a medical decision. Being wrong about which day it is for two hours a
  night is not an acceptable way to reject someone (`CLAUDE.md` §5: identity, medicine and consent
  never resolve themselves loosely).
- Deterministic and explainable beats clever (ASSIGNMENT.md §3B): the day must come from one named
  zone that a reviewer can read, not from wherever the server happens to be deployed.
- The form and the API must agree about what day it is, or the field offers a day its own server
  refuses (ADR-0016 item 1).

## Considered options

1. **Keep UTC** and accept the window.
2. **The clinic's zone, named in code** — derive the calendar day in `Europe/Amsterdam`.
3. **The server's local zone** — `toLocaleDateString()` with no zone argument.
4. **The patient's zone**, sent by the browser.

## Decision outcome

Chosen option: **Option 2**, `Europe/Amsterdam`, as a named constant with the day derived through
`Intl.DateTimeFormat`.

Option 1 is the bug. Option 3 makes the answer depend on the deployment — Vercel runs UTC, a
laptop does not, so the same submission would be judged differently in two environments and the
test suite would agree with neither. Option 4 lets the client decide a medical input, which R-T4
forbids and which a patient could set to anything; it is also the wrong question, since the rule
being applied is Wellis's rule about Wellis's day, not the patient's.

### 1. One definition

`src/intake/today.ts` exports `CLINIC_TIME_ZONE`, `dayOf(at: Date)` and `todayIso()`. Everything
that needs a calendar day — the page's `dobBounds`, both intake routes' validation, and
`submitIntake`'s age, `signup_date` and `submitted_at` — goes through it. `submitIntake` keeps
taking the submission **instant** (`now: Date`) and converts it once, so the instant stored in
`consent_events.at` and the day stored on the intake are the same event seen two ways.

The day is assembled from `Intl.DateTimeFormat(...).formatToParts` rather than from a locale whose
output happens to look like ISO, so the format is ours and not the runtime's.

### 2. What this does not change

The **legacy** side is untouched. The importer's dates come from the export as exported (ADR-0009
item 1) and are not re-interpreted against a zone; `consent_events.at` remains a `timestamptz`
holding an instant (ADR-0007). This ADR is about deriving a *calendar day* from an instant, which
only the new flow does.

### Consequences

- Good: the age that decides eligibility is the age the patient would say they are, in the country
  where the decision is made.
- Good: the same submission is judged identically on a laptop, in CI and on Vercel.
- Bad: a hard-coded zone is wrong the day Wellis opens in another country. Accepted as YAGNI, and
  it is one named constant with one reader when that day comes.
- Neutral: the DST transitions are handled by the runtime's tz database, not by arithmetic here.

### Confirmation

- Unit test: an instant at 22:30 UTC in July and 23:30 UTC in January both resolve to the *next*
  calendar day, which is the day it is in Amsterdam — and the UTC day is the day before.
- Unit test: `dobBounds` and the identity schema agree on the clinic day, not the UTC one.
- Integration test: a submission made in the local-midnight window by a patient whose 18th birthday
  is that day is not `age_below_minimum`.

## More information

- ADR-0010 and `QUESTIONS.md` Q4 (age is taken at submission), ADR-0014 item 5 and
  `src/intake/machine.ts` (`refusesAbsoluteReject`), ADR-0016 item 1 (one day for field and API).
- `rules/v1.json` → `precedence.absolute_rejects`.
