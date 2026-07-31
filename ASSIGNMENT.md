# Wellis Take-Home — Patient Intake & Legacy Migration

**Role:** Senior Engineer, Patient Information Management
**Deadline:** 7 days from receipt · **Follow-up:** 90-minute deep-dive on your submission

---

## 1. The scenario

Wellis is a Dutch telehealth company running a medically supervised weight-care
programme. For years, patient onboarding ran on a no-code stack: a form tool for
intake, automation glue in the middle, and a spreadsheet-style database as the "patient
system of record." The data in it is now the kind of data that stack produces.

You are joining the team that replaces this. Your assignment is to build **Intake**: a
small but production-shaped patient information service that

1. **imports the legacy export** you've been given without silently destroying
   information,
2. **runs new patient intakes** through a deterministic eligibility check, and
3. gives the care team a **review console** to work everything that needs human eyes.

All patient data in this assignment is synthetic. No real person appears in it.

---

## 2. What you're given

```
legacy_export/
  patients.csv      ~2,600 patient records from the old system
  intakes.csv       ~3,100 historical intake submissions
  consents.jsonl    consent events (one JSON object per line)
  EXPORT-NOTES.md   what the old team could tell us about this data
```

The export is messy in the ways real exported data is messy. Part of the assignment is
discovering *how* it is messy. Assume nothing; verify everything.

---

## 3. What to build

### Part A — Legacy import & reconciliation

Build an import pipeline that loads the legacy export into **your own schema**.

Ground rules:

- **Never silently drop or overwrite data.** Anything you normalise, merge, or fix
  automatically must be recorded (what changed, from what, to what, why).
- **Auto-fix only what is safely auto-fixable.** Where the data is genuinely ambiguous
  or contradictory, do not guess. Park the record in a **review queue** with enough
  context for a human to resolve it.
- The import must be **repeatable and idempotent**: running it twice must not create
  duplicates.
- Produce an **import report** (in the UI, a file, or both): what came in, what was
  cleaned, what was quarantined, the rules you applied, and anything you found that
  `EXPORT-NOTES.md` did not warn you about.

We care far more about *what your importer notices* than about the cleverness of any
individual fix.

### Part B — New patient intake & eligibility

Build a patient-facing intake flow (it can be plain, it must be correct):

- A multi-step intake form collecting at minimum: identity (name, email, date of birth),
  body metrics (height, weight), current medications, relevant conditions, and consent.
- A **deterministic eligibility rules engine** that evaluates a submitted intake:

  | Rule | Outcome |
  |---|---|
  | Age under 18 | reject |
  | BMI below 27 | reject |
  | BMI 27–30 without a weight-related condition | flag for review |
  | Currently using a GLP-1 medication | flag for review |
  | History of thyroid cancer or pancreatitis (self-reported) | flag for review |
  | Everything else | clear for doctor review |

  Rules must be **versioned**: an intake stores *which* ruleset evaluated it, and every
  outcome must carry a human-readable explanation ("flagged: BMI 27.4 with no
  weight-related condition").
- An intake moves through an explicit **state machine**, at minimum:
  `draft → submitted → (auto_cleared | auto_flagged | auto_rejected) → in_review →
  (approved | rejected)`. Illegal transitions must be impossible, not just avoided.
- **Every state change and every human decision is audit-logged**: who/what, when, from
  state, to state, reason.

The product itself does **not** need any AI/LLM features. Deterministic and explainable
beats clever.

### Part C — Review console

One React app for the care team:

- A **work queue** combining the two sources of work: flagged/ambiguous **import
  conflicts** (Part A) and flagged **intakes** (Part B). Filter/sort by type, age, and
  status.
- A conflict-resolution view: show the competing versions of the truth side by side; the
  reviewer picks or edits the winning values, with a required note.
- An intake-review view: the submission, the rule evaluation with explanations, and
  approve/reject with a required note.
- A patient detail view: current record, their intakes, and the **full audit history** of
  how the record came to look the way it does.

Don't chase polish. The bar is whether a reviewer could do a day's work in it.

---

## 4. Constraints

- **Frontend:** React + TypeScript.
- **Backend:** Node/TypeScript API you design, with a real database (Postgres or SQLite,
  your choice; Supabase-hosted Postgres is fine, but the API and its logic must be your
  code, not rows-over-REST straight from the client).
- **Deployed:** the app must be reachable at a URL (Vercel, Fly.io, Railway, Cloud Run,
  anything). Seed the deployed instance with your imported dataset.
- **Tests where they matter.** We do not want 100% coverage; we want the eligibility
  engine, the state machine, and the gnarliest import logic to be provably correct.
- Repo access for us, with real commit history (don't squash it all into one commit).

## 5. The agentic-coding requirement

We expect this to be built with AI coding agents (Claude Code or equivalent). That is
part of what we are evaluating, and it is why the scope above is bigger than a classic
take-home.

You must submit:

1. **Your full agent traces/session logs**, unedited. We read them.
2. A short **`AGENT-NOTES.md`** (~1 page): how you decomposed the work for the agent,
   where you let it run vs. where you took the wheel, at least one concrete case where
   you rejected or corrected its output, and what you'd do differently.

We are not checking whether you used an agent. We are evaluating how you direct one
through the decisions that matter: schema design, merge semantics, state modelling. An
agent that was never told what "correct" means produces plausible-looking wrong
systems; your traces should show us that you noticed.

## 6. Time expectations & scope judgment

There is no hour cap. Our calibration: a focused day of your attention, amplified by
agents, should produce something substantial. Use agents to go further, not longer.

If you cut scope, cut it deliberately and say so in the README ("I skipped X because
Y"). Scope judgment is a senior skill and we grade it as one. A smaller system whose
data handling is trustworthy beats a bigger one whose importer guessed.

## 7. Deliverables checklist

- [ ] Deployed URL (seeded with the imported legacy data)
- [ ] Repo access (with commit history)
- [ ] `README.md` — setup, architecture overview, schema, and your key decisions with reasoning
- [ ] Import report (§3A)
- [ ] Agent traces + `AGENT-NOTES.md` (§5)

## 8. What the 90-minute follow-up looks like

You walk us through the system live (10–15 min); then we go deep on your schema and
import decisions, review a few records together, look at parts of your agent traces
with you, and make one or two small change requests to discuss or implement. Nothing in
the follow-up is a trick; all of it is about choices you already made.

If anything is unclear before you start, ask us. Sharp questions count in your favour.
