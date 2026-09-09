# Requirements — Wellis Intake (extracted from ASSIGNMENT.md)

Derived requirements, restated with the normative keywords of
[RFC 2119](https://datatracker.ietf.org/doc/html/rfc2119): **MUST** / **MUST NOT** /
**REQUIRED**, **SHOULD** / **SHOULD NOT** / **RECOMMENDED**, **MAY** / **OPTIONAL**.

Keyword mapping used while extracting:

| Source wording in ASSIGNMENT.md | Keyword assigned |
|---|---|
| "must", "must be", "Illegal transitions must be impossible", deliverables checklist, §4 Constraints, §5 "You must submit" | **MUST** |
| "at minimum: …" enumerations | **MUST** (the listed items), **MAY** (anything beyond) |
| "We care far more about…", "we grade it as one", "The bar is whether…", "Don't chase polish" | **SHOULD** |
| explicit alternatives ("in the UI, a file, or both", "Postgres or SQLite, your choice") | **MAY** |
| "does not need any AI/LLM features" | **OPTIONAL** / **SHOULD NOT** (see R-B10) |

Traceability: each requirement cites the assignment section it comes from. `⚠` marks a
requirement whose scope is under-specified in the source — see §7 Open questions.

---

## 1. Product scope (§1, §3)

| ID | Requirement | Source |
|---|---|---|
| R-S1 | The system, named **Intake**, **MUST** consist of three capabilities: legacy import, new-patient intake with eligibility evaluation, and a care-team review console. | §1 |
| R-S2 | The system **MUST** be production-shaped: a designed API, a real database, and a deployed URL — not a local script or notebook. | §1, §4 |
| R-S3 | The system **MUST NOT** rely on any AI/LLM feature for its product behaviour; outcomes **MUST** be deterministic and explainable. | §3B |
| R-S4 | Deliberate scope cuts **MUST** be recorded in `README.md`, each stating what was cut and why. | §6 |
| R-S5 | Trustworthy data handling **SHOULD** be prioritised over breadth of features when the two conflict. | §6 |

---

## 2. Part A — Legacy import & reconciliation (§3A)

### 2.1 Ingestion

| ID | Requirement | Source |
|---|---|---|
| R-A1 | The importer **MUST** load all four artefacts of `legacy_export/`: `patients.csv` (~2,600 rows), `intakes.csv` (~3,100 rows), `consents.jsonl` (one JSON object per line), guided by `EXPORT-NOTES.md`. | §2, §3A |
| R-A2 | Imported data **MUST** land in a schema of my own design; the legacy column layout **MUST NOT** be adopted as the target schema. | §3A |
| R-A3 | The importer **MUST NOT** assume that `EXPORT-NOTES.md` is correct or complete; every documented claim **MUST** be verified against the data. | §2, §3A |
| R-A4 | The importer **MUST** treat `intakes.csv:legacy_patient_id` as an unreliable foreign key and handle orphan intakes (intake rows whose patient row is absent) without failing the run. | Export notes, §3A |

### 2.2 Non-destructiveness

| ID | Requirement | Source |
|---|---|---|
| R-A5 | The importer **MUST NOT** silently drop any input record. | §3A |
| R-A6 | The importer **MUST NOT** silently overwrite any input value. | §3A |
| R-A7 | Every automatic normalisation, merge, or fix **MUST** be recorded with: what changed, the *from* value, the *to* value, and the reason. | §3A |
| R-A8 | The original, as-exported value **MUST** remain recoverable after import (raw retention or a complete change log). | §3A (implied by R-A5–R-A7) |

### 2.3 Auto-fix vs. review

| ID | Requirement | Source |
|---|---|---|
| R-A9 | The importer **MUST** auto-fix only what is *safely* auto-fixable. | §3A |
| R-A10 | Where data is genuinely ambiguous or contradictory, the importer **MUST NOT** guess. | §3A |
| R-A11 | Such records **MUST** be parked in a **review queue**. | §3A |
| R-A12 | Each queued item **MUST** carry enough context for a human to resolve it without re-reading the raw export. | §3A |
| R-A13 | The classification boundary between "safely auto-fixable" and "ambiguous" **MUST** be stated explicitly as a rule set, not left implicit in code. | §3A ("the rules you applied") |

### 2.4 Repeatability

| ID | Requirement | Source |
|---|---|---|
| R-A14 | The import **MUST** be repeatable. | §3A |
| R-A15 | The import **MUST** be idempotent: a second run **MUST NOT** create duplicate records. | §3A |
| R-A16 | Idempotency **MUST** be demonstrable (e.g. a test or a documented double-run with identical resulting counts). | §3A + §4 tests |
| R-A17 | Re-running the import **SHOULD NOT** discard human decisions already made in the review queue. | §3A (non-destructiveness ∘ repeatability) ⚠ |

### 2.5 Import report

| ID | Requirement | Source |
|---|---|---|
| R-A18 | An **import report MUST** be produced. It **MAY** be surfaced in the UI, as a file, or both. | §3A |
| R-A19 | The report **MUST** state what came in (volumes/counts per source). | §3A |
| R-A20 | The report **MUST** state what was cleaned. | §3A |
| R-A21 | The report **MUST** state what was quarantined. | §3A |
| R-A22 | The report **MUST** state the rules applied. | §3A |
| R-A23 | The report **MUST** state findings not warned about in `EXPORT-NOTES.md`. | §3A |
| R-A24 | The importer **SHOULD** be judged by what it *notices*; breadth of detected anomalies **SHOULD** be favoured over cleverness of any individual fix. | §3A |

### 2.6 Data hazards that MUST be addressed explicitly

Each hazard is either auto-fixed with a recorded rule (R-A7) or routed to review (R-A11).

| ID | Hazard | Source |
|---|---|---|
| R-A25 | Ambiguous date formats — ISO vs. US-style ordering, with an unknown cut-over date. | Export notes |
| R-A26 | Weight units — kg vs. lbs, with `weight_unit` added late and backfilled only "where obvious". | Export notes |
| R-A27 | `height_cm` "always intended as centimetres" — **MUST** be verified, not trusted. | Export notes |
| R-A28 | `status` free-spelling variants across automations and humans. | Export notes |
| R-A29 | `outcome` free-spelling variants, distinct from patient-level `status`. | Export notes |
| R-A30 | Unvalidated `bsn` values. | Export notes |
| R-A31 | Duplicate patients — same person signed up twice under different emails. Merge semantics **MUST** be defined; non-obvious candidates **MUST** go to review. | Export notes, §5 |
| R-A32 | Unenforced `phone` formats, free-text `sex`, self-reported `city`. | Export notes |
| R-A33 | Free-text `meds_current` and `conditions`, mixed Dutch/English. | Export notes |
| R-A34 | `questionnaire_version` labelling inconsistency. | Export notes |
| R-A35 | Consent event log: `granted`/`revoked` ordering, and incompleteness before 2023. Current consent state **MUST** be derived from the event sequence, not from the last line alone. | Export notes |
| R-A36 | Divergence between `intakes.csv` and `patients.csv` weight/height **MUST NOT** be treated as an error — it is legitimate (self-reported at submission time). | Export notes |
| R-A37 | Anomalies beyond this list **SHOULD** be discovered by profiling the data ("Assume nothing; verify everything") and reported under R-A23. | §2 |

---

## 3. Part B — New intake & eligibility (§3B)

### 3.1 Intake form

| ID | Requirement | Source |
|---|---|---|
| R-B1 | A patient-facing, **multi-step** intake form **MUST** exist. | §3B |
| R-B2 | The form **MUST** collect at minimum: identity (name, email, date of birth), body metrics (height, weight), current medications, relevant conditions, and consent. | §3B |
| R-B3 | The form **MAY** collect additional fields beyond R-B2. | §3B ("at minimum") |
| R-B4 | The form **MUST** be correct; it **MAY** be visually plain. | §3B |

### 3.2 Eligibility rules engine

| ID | Requirement | Source |
|---|---|---|
| R-B5 | Eligibility evaluation **MUST** be deterministic: the same intake and the same ruleset version **MUST** always yield the same outcome. | §3B |
| R-B6 | The engine **MUST** implement exactly these rules: (a) age under 18 → **reject**; (b) BMI below 27 → **reject**; (c) BMI 27–30 without a weight-related condition → **flag for review**; (d) current GLP-1 medication use → **flag for review**; (e) self-reported history of thyroid cancer or pancreatitis → **flag for review**; (f) everything else → **clear for doctor review**. | §3B |
| R-B7 | Rule precedence **MUST** be defined and deterministic when several rules match (e.g. reject outranks flag). | §3B ⚠ |
| R-B8 | Rulesets **MUST** be versioned, and each intake **MUST** store which ruleset version evaluated it. | §3B |
| R-B9 | Every outcome **MUST** carry a human-readable explanation naming the triggering values (e.g. "flagged: BMI 27.4 with no weight-related condition"). | §3B |
| R-B10 | The engine **MUST NOT** use an LLM or any non-deterministic component. | §3B |
| R-B11 | The definition of "weight-related condition" and of "GLP-1 medication" **MUST** be an explicit, versioned, inspectable list — versioned together with the ruleset. | §3B ⚠ |
| R-B12 | BMI computation and its unit handling **MUST** be specified, including rounding and boundary semantics for the 27 and 30 thresholds. | §3B ⚠ |

### 3.3 State machine

| ID | Requirement | Source |
|---|---|---|
| R-B13 | An intake **MUST** move through an explicit state machine containing at minimum: `draft → submitted → (auto_cleared \| auto_flagged \| auto_rejected) → in_review → (approved \| rejected)`. | §3B |
| R-B14 | Additional states/transitions **MAY** be added beyond the minimum. | §3B ("at minimum") |
| R-B15 | Illegal transitions **MUST** be impossible — structurally prevented, not merely avoided by convention. | §3B |
| R-B16 | Enforcement **MUST** hold at the API/persistence layer, so a client cannot drive an intake into an illegal state. | §3B, §4 (logic is server-side) |
| R-B17 | The state machine **MUST** be covered by tests proving illegal transitions are rejected. | §4 |

### 3.4 Audit log

| ID | Requirement | Source |
|---|---|---|
| R-B18 | Every state change **MUST** be audit-logged. | §3B |
| R-B19 | Every human decision **MUST** be audit-logged. | §3B |
| R-B20 | Each audit entry **MUST** record: actor (who or what — human or system), timestamp, from-state, to-state, and reason. | §3B |
| R-B21 | Audit entries **SHOULD** be append-only; they **MUST NOT** be silently rewritten or deleted. | §3A/§3B (non-destructiveness) |

---

## 4. Part C — Review console (§3C)

| ID | Requirement | Source |
|---|---|---|
| R-C1 | The care team **MUST** be served by **one** React application. | §3C, §4 |
| R-C2 | A **work queue MUST** combine both work sources: flagged/ambiguous import conflicts (Part A) and flagged intakes (Part B). | §3C |
| R-C3 | The work queue **MUST** support filtering and sorting by **type**, **age**, and **status**. | §3C |
| R-C4 | A **conflict-resolution view MUST** show the competing versions of the truth side by side. | §3C |
| R-C5 | In that view the reviewer **MUST** be able both to pick a winning value and to edit it. | §3C |
| R-C6 | A note **MUST** be required to submit a conflict resolution. | §3C |
| R-C7 | An **intake-review view MUST** show the submission, and the rule evaluation together with its explanations. | §3C |
| R-C8 | That view **MUST** offer approve and reject actions, each requiring a note. | §3C |
| R-C9 | A **patient detail view MUST** show the current record, the patient's intakes, and the **full audit history** explaining how the record reached its present state. | §3C |
| R-C10 | The console **SHOULD** let a reviewer do a full day's work; visual polish **SHOULD NOT** be pursued beyond that bar. | §3C |

---

## 5. Technical constraints (§4)

| ID | Requirement | Source |
|---|---|---|
| R-T1 | The frontend **MUST** be React with TypeScript. | §4 |
| R-T2 | The backend **MUST** be a Node/TypeScript API of my own design. | §4 |
| R-T3 | A real database **MUST** be used; it **MAY** be Postgres or SQLite, and **MAY** be Supabase-hosted Postgres. | §4 |
| R-T4 | All business logic **MUST** live in my own API. The client **MUST NOT** talk to the database directly (no rows-over-REST). | §4 |
| R-T5 | The app **MUST** be deployed and reachable at a URL; the hosting provider **MAY** be any (Vercel, Fly.io, Railway, Cloud Run, …). | §4, §7 |
| R-T6 | The deployed instance **MUST** be seeded with the imported legacy dataset. | §4, §7 |
| R-T7 | Tests **MUST** cover the eligibility engine, the state machine, and the gnarliest import logic, and **MUST** be strong enough to make them provably correct. | §4 |
| R-T8 | 100% coverage **MUST NOT** be a goal; tests **SHOULD** be concentrated where correctness matters. | §4 |
| R-T9 | The repository **MUST** be accessible to the reviewers. | §4, §7 |
| R-T10 | Commit history **MUST** be real and incremental; the work **MUST NOT** be squashed into a single commit. | §4 |

---

## 6. Process & submission (§5, §7)

| ID | Requirement | Source |
|---|---|---|
| R-P1 | The work **MUST** be built with AI coding agents (Claude Code or equivalent). | §5 |
| R-P2 | Full agent traces / session logs **MUST** be submitted, **unedited**. | §5 |
| R-P3 | `AGENT-NOTES.md` (~1 page) **MUST** be submitted. | §5, §7 |
| R-P4 | `AGENT-NOTES.md` **MUST** cover: (a) how the work was decomposed for the agent; (b) where the agent ran freely vs. where I took the wheel; (c) at least one concrete case where I rejected or corrected its output; (d) what I would do differently. | §5 |
| R-P5 | The traces **SHOULD** demonstrate that I directed the agent through the decisions that matter — schema design, merge semantics, state modelling — and that I noticed where "correct" had to be defined. | §5 |
| R-P6 | `README.md` **MUST** contain: setup instructions, an architecture overview, the schema, and my key decisions with reasoning. | §7 |
| R-P7 | The deliverables **MUST** be: deployed seeded URL, repo access with history, `README.md`, the import report, agent traces, `AGENT-NOTES.md`. | §7 |
| R-P8 | Delivery **MUST** be within 7 days of receipt. | header |
| R-P9 | I **SHOULD** be able to walk the system live in 10–15 minutes and defend schema and import decisions, review individual records on the spot, discuss the traces, and implement one or two small change requests during the 90-minute follow-up. | §8 |
| R-P10 | Unclear points **SHOULD** be raised with the reviewers before starting; sharp questions are credited. | §8 |
| R-P11 | There **MUST NOT** be an hour cap treated as a constraint; agents **SHOULD** be used to go further rather than longer. | §6 |

---

## 7. Open questions (candidates for R-P10)

Points where the assignment is genuinely under-specified and my choice must be
documented (⚠ above):

1. **Rule precedence (R-B7).** An intake can be simultaneously reject-worthy (BMI 25)
   and flag-worthy (GLP-1 use) — GLP-1 use itself commonly *lowers* BMI below 27. Does
   reject win, or does a GLP-1 flag pre-empt the BMI reject? My default: the engine
   collects all matched rules, and a reject+flag collision resolves to `auto_flagged` for
   human resolution — except age under 18, which stays an absolute reject as a legal gate.
   All matched rules are recorded in the explanation regardless of outcome.
2. **BMI boundaries (R-B12).** "BMI below 27 → reject" and "BMI 27–30 → flag" leave 30
   itself ambiguous against "everything else". My default: reject if BMI < 27.0, flag if
   27.0 ≤ BMI ≤ 30.0, clear above 30.0, computed on unrounded BMI and displayed at one
   decimal.
3. **"Weight-related condition" and "GLP-1 medication" lists (R-B11).** No clinical list
   is given, and legacy `conditions`/`meds_current` are free text in two languages.
   My default: an explicit versioned dictionary with Dutch and English synonyms; matching
   is recorded in the explanation so a reviewer can see why a term matched.
4. **Re-import vs. human decisions (R-A17).** Whether a second import may revisit
   conflicts a reviewer has already resolved. My default: resolved conflicts are
   immutable; a re-import that would contradict one raises a new item instead.
5. **Authentication of reviewers.** Audit entries must name "who" (R-B20), but no auth
   requirement is stated. My default: lightweight identification of the actor rather than
   a real auth system, called out as a deliberate scope cut under R-S4.
6. **Age reference date.** Age under 18 — measured at submission time or at evaluation
   time? My default: at intake submission time, stored with the evaluation.
