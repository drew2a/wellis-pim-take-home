# Open questions for Wellis — with impact analysis

Candidate questions for the reviewers (ASSIGNMENT.md §8: "If anything is unclear before
you start, ask us. Sharp questions count in your favour."). Each entry gives the
ambiguity, the plausible answers, what each answer changes in the build, my default if
no answer comes back, and a send/don't-send verdict.

Grading logic for the verdict: a question is worth sending when (a) the assignment
genuinely does not determine the answer, (b) different answers lead to materially
different work, and (c) the answer is theirs to give rather than a judgment call they
want to see me make. Questions that fail (c) are better answered in the README as a
documented decision — asking them would signal that I want to be told what "correct"
means, which §5 explicitly grades against.

---

## Q1 — Rule precedence when several eligibility rules match  📤 sent

**Status.** Sent to the reviewers 2026-09-09; awaiting answer. Proceeding on the
default below until they reply.

**Ambiguity.** The rule table (§3B) lists six rules with three outcome classes
(reject / flag / clear) but no precedence. A single intake can match a *reject* rule and a
*flag* rule at once. The realistic case: a patient currently on a GLP-1 (flag) whose BMI
has dropped below 27 *because* of the GLP-1 (reject). A GLP-1 patient asking for
medically supervised weight care is arguably the core customer, and auto-rejecting them
looks clinically wrong.

**Possible answers.**

| Answer | Impact on build |
|---|---|
| A. Reject always wins over flag (strict severity ordering) | Simplest engine: evaluate hard rejects first, short-circuit. Explanation still lists all matched rules. |
| B. Any flag pre-empts an automatic reject — a human decides | Engine becomes "collect all matches, then resolve": outcome = flag if any flag matched, else reject if any reject matched, else clear. `auto_rejected` becomes rarer; review queue grows. |
| C. Only the GLP-1 flag pre-empts the BMI reject; age-under-18 reject is absolute | Special-case precedence table per rule pair. Needs an explicit precedence matrix stored with the ruleset version. |

**Default if unanswered.** **B, with one carve-out.** The engine collects *all* matched
rules (no short-circuit) and then resolves:

| Matched | Outcome |
|---|---|
| age-under-18 reject (alone or with anything else) | `auto_rejected` — absolute, see carve-out |
| a reject rule **and** a flag rule | `auto_flagged`, explanation names the conflict explicitly |
| reject rule(s) only | `auto_rejected` |
| flag rule(s) only | `auto_flagged` |
| none | `auto_cleared` |

*Carve-out:* **age under 18 stays an absolute reject.** It is a legal eligibility gate, not
a clinical judgment — a reviewer cannot resolve "this patient is 16" in the patient's
favour, so routing it to review only creates the opportunity to approve someone
ineligible. Every other reject (BMI) yields to a flag.

Precedence lives in the versioned ruleset, so switching to A or C is configuration, not a
rewrite.

**Why send.** Different answers change the engine's architecture (short-circuit vs.
collect-and-resolve) and the size of the review queue. It is a *clinical/product*
decision, not an engineering one — genuinely theirs. Also shows I read the rules as a
system rather than as six independent lines.

---

## Q2 — BMI boundary semantics  ✅ send (can be folded into Q1)

**Ambiguity.** "BMI below 27 → reject" and "BMI 27–30 without weight-related condition
→ flag" leave BMI exactly 30.0 undetermined (is 30 in the flag band or in "everything
else"?), and do not say whether the thresholds apply to unrounded or rounded BMI. At
one-decimal rounding, 26.95 becomes 27.0 and flips outcome.

**Possible answers.**

| Answer | Impact on build |
|---|---|
| A. Inclusive band: 27.0 ≤ BMI ≤ 30.0 flag; > 30.0 clear; unrounded BMI | Two comparison operators; rounding only in the explanation string. |
| B. Half-open band: 27.0 ≤ BMI < 30.0 flag; ≥ 30.0 clear | Same complexity, different edge case. |
| C. Thresholds apply to BMI rounded to 1 decimal (what the patient sees) | Rounding must be part of the versioned ruleset; test cases must cover 26.95/26.94. |

**Default if unanswered.** A, computed on unrounded BMI, displayed to one decimal, with
boundary tests at 26.99 / 27.00 / 30.00 / 30.01.

**Why send.** Cheap to ask, almost zero cost to change, but a boundary mistake in an
eligibility engine is exactly the type of bug the 90-minute follow-up would probe. Best
sent as a sub-bullet of Q1 to avoid looking pedantic.

---

## Q3 — Definition of "weight-related condition" and "GLP-1 medication"  ✅ send

**Ambiguity.** Both are load-bearing terms in the rule table but no list is given.
Legacy `conditions` / `meds_current` are free text in Dutch and English
(EXPORT-NOTES.md), so the new form's design also depends on this.

**Possible answers.**

| Answer | Impact on build |
|---|---|
| A. They will provide (or point to) a clinical list | Encode as versioned dictionary; my job is matching, not medicine. |
| B. "Use your judgment, document it" | I own a versioned dictionary (e.g. type 2 diabetes, hypertension, sleep apnoea, dyslipidaemia, PCOS, NAFLD; semaglutide/Ozempic/Wegovy, liraglutide/Saxenda, tirzepatide/Mounjaro, dulaglutide, exenatide) with NL/EN synonyms, and flag unknown terms for review. |
| C. The new form should use structured pick-lists so no matching is needed | Changes form design (checkbox lists + "other" free text); the rule engine consumes codes, not text. Free text goes to review only when "other" is used. |

**Default if unanswered.** C for the new form (structured input + optional free text),
B for the dictionary, and any free text that fails to match routes to `auto_flagged`
with the explanation "unrecognised medication/condition text".

**Why send.** The answer decides whether Part B is a text-matching problem or a form-design
problem — materially different work. It also surfaces a real safety point: a rules engine
on free text will miss "Ozempic" spelled "ozempik".

---

## Q4 — Age reference date  ⚪ optional (fold into Q1/Q2 as a sub-bullet)

**Ambiguity.** "Age under 18 → reject" — measured at intake submission, at evaluation
time, or at planned start of treatment?

**Impact.** Only matters for patients within days of their 18th birthday; changes one
line in the engine and which timestamp is persisted with the evaluation.

**Default if unanswered.** Age at submission time, stored with the evaluation so re-running
a newer ruleset later reproduces the same age.

**Why optional.** Low impact; asking it alone looks pedantic, but it rounds out a single
"rules-engine edge cases" question nicely.

---

## Q5 — Re-import versus human decisions already made  📤 sent

**Status.** Sent to the reviewers 2026-09-09; awaiting answer. Proceeding on the
default below until they reply.

**Ambiguity.** The import must be idempotent (§3A) and must never silently overwrite
(§3A). The review queue produces human resolutions. Nothing says what happens when the
importer runs again — or runs on a *refreshed* export — after a reviewer has resolved a
conflict or edited a record.

**Possible answers.**

| Answer | Impact on build |
|---|---|
| A. Import is one-shot against this fixed export; re-runs only need to be no-ops | Idempotency key per source row is enough; no conflict-with-human-decision logic needed. |
| B. Re-import must preserve human decisions; a contradicting source value raises a *new* review item | Need a "resolved" marker per conflict, provenance on every field (system vs. human), and a rule that human-set fields are never auto-overwritten. Materially more schema. |
| C. Re-import may reset everything (fresh load) | Simplest, but destroys human work — conflicts with "never silently drop". Unlikely intended. |

**Default if unanswered.** B — human-resolved values are immutable to the importer;
field-level provenance is stored; a re-import that would contradict a human decision
raises a new queue item referencing the old one.

**Why send.** Touches schema design directly (field-level provenance or not), which §5
names as one of the decisions they grade. The answer distinguishes "importer for a
migration" from "importer for an ongoing sync" — very different systems.

---

## Q6 — Duplicate-patient merge semantics  ⭐ send

**Ambiguity.** Ops says "some people definitely signed up twice with different emails".
The assignment says merges must be recorded and ambiguous ones queued, but does not say
what a *resolved* merge should look like or what counts as safe.

**Possible answers.**

| Answer | Impact on build |
|---|---|
| A. Never auto-merge; every candidate pair goes to review | Simplest and safest; review queue may hold hundreds of pairs, which affects console UX (bulk actions?). |
| B. Auto-merge only exact matches on (normalised name + dob), queue the rest | Need a match-scoring function, a documented threshold, and merge-recording in the audit log. |
| C. Merged records keep both legacy IDs as aliases; intakes/consents of both are attached to the survivor | Requires a `legacy_id → patient` alias table so `intakes.csv` and `consents.jsonl` references stay resolvable after merge. Affects schema. |

**Default if unanswered.** A for automatic behaviour (no auto-merge), C for the
data model (alias table), so a reviewer's merge decision is reversible and every legacy
reference still resolves.

**Why send.** Merge semantics are named verbatim in §5 as a graded decision. A one-line
answer ("never auto-merge people" vs. "exact name+dob is fine") halves or doubles the
review queue and determines whether I need a scoring function at all.

---

## Q7 — Consent semantics for legacy patients  ✅ send

**Ambiguity.** `consents.jsonl` is "believed complete from 2023 onwards; before that,
nobody is sure". Patients with no consent event, or whose last event is `revoked`, still
have medical data in the export. Nothing says what to do with them.

**Possible answers.**

| Answer | Impact on build |
|---|---|
| A. Import everyone; consent state is just a field the console shows | No filtering; add a `consent_status` (granted / revoked / unknown) column and a work-queue filter. |
| B. Patients with revoked consent must be imported but marked restricted (data minimisation) | Need a restricted flag that hides medical fields in the console unless the reviewer acts. |
| C. Patients with no consent record before 2023 go to the review queue | Review queue grows by however many pre-2023 patients lack events; possibly large. |

**Default if unanswered.** A, plus a "consent unknown / revoked" filter in the work
queue and an explicit line in the import report counting each state.

**Why send.** This is a GDPR-adjacent decision in a Dutch health company — precisely the
type of thing a senior engineer should not decide unilaterally, and asking demonstrates
domain awareness. Cost of asking is low.

---

## Q8 — Reviewer identity / authentication  ⚪ optional

**Ambiguity.** Audit entries must record "who/what" (§3B), but no authentication
requirement appears anywhere.

**Possible answers.**

| Answer | Impact on build |
|---|---|
| A. No auth needed; a reviewer name selector or header is fine | Trivial; store actor string per action. |
| B. Real login expected | Adds a full auth stack (sessions, users table, password or magic-link) — a day of work on its own. |

**Default if unanswered.** A, documented as a deliberate scope cut (§6), with the audit
schema already carrying an `actor_id` so real auth slots in later.

**Why optional.** The assignment's silence plus "don't chase polish" strongly implies A.
Asking risks sounding like I want permission to skip work. Better handled as a README
scope note.

---

## Q9 — Orphan intakes and pre-existing outcomes  ⚪ optional

**Ambiguity.** `intakes.csv` rows may reference patients that do not exist (automation
fired early). Also, historical intakes already carry an `outcome` (approved / rejected /
pending). Should legacy intakes be (a) re-evaluated by the new rules engine, (b) stored
as-is with their legacy outcome, or (c) both, with disagreements reported?

**Impact.** (c) is the interesting one: it produces a "the new engine disagrees with
N historical decisions" figure for the import report and a source of review items.
Changes whether legacy intakes enter the Part B state machine at all.

**Default if unanswered.** Store legacy outcome as-is (mapped to a terminal legacy state
outside the new state machine), run the current ruleset over them in *shadow mode*,
report disagreements in the import report, do not queue them. Orphan intakes are imported
with a null patient reference and queued; **no placeholder patient is created** (changed
2026-09-09 after profiling: the 21 orphans have no name, date of birth or email anywhere in the
export, so a placeholder would be a fabricated patient record, while a null reference plus a
review item states exactly what is known; see `docs/findings.md`, `legacy_patient_id`).

**Why optional.** The default is defensible and demonstrates initiative; asking might
pre-empt a finding they want me to make on my own.

---

## Q10 — Format of agent traces  📤 sent (logistics)

**Status.** Sent to the reviewers 2026-09-09; awaiting answer. Proceeding on the
default below until they reply.

**Ambiguity.** "Full agent traces/session logs, unedited" — Claude Code stores sessions
as JSONL under `~/.claude/projects/`. Do they want the raw JSONL, a rendered transcript,
or both? Should they be committed to the repo or delivered separately (they can be tens of
MB and include file contents)?

**Impact.** Pure logistics, but getting it wrong means a deliverable is rejected.

**Default if unanswered.** Raw JSONL committed to a `traces/` directory in the repo,
plus a short index in `AGENT-NOTES.md` pointing to the sessions that contain the graded
decisions.

**Why send.** Zero risk, shows care about their process, and avoids a submission-format
mismatch.

---

## Suggested selection

**Sent 2026-09-09: Q1, Q5, Q10.** Q2 (BMI boundary) and Q4 (age reference date) were
deliberately left out to keep Q1 focused; both defaults stand and are cheap to change.
Q3, Q8 and Q9 were not sent and will be documented as decisions instead.

The original bundling recommendation, kept for the record:

1. **Q1 + Q2 (+ Q4)** as one "rules-engine edge cases" question — highest impact,
   clearly theirs to answer.
2. **Q6** merge semantics — named in §5 as graded.
3. **Q5** re-import vs. human decisions — decides the provenance model.
4. **Q7** consent — domain awareness signal.
5. **Q10** trace format — logistics, one line.

Q3 is borderline: high impact, but they may prefer to see me build the dictionary
(§5: "an agent that was never told what correct means…" applies to me too). Send it only
if the message is not already long.

Q8 and Q9 are better answered in the README as documented decisions.
