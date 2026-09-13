# Wellis take-home — Patient Intake & Legacy Migration

Take-home assignment for the Senior Engineer role on the Patient Information
Management team at Wellis.

Start with [ASSIGNMENT.md](ASSIGNMENT.md). The dataset you'll be working with is in
[`legacy_export/`](legacy_export/), described in
[`legacy_export/EXPORT-NOTES.md`](legacy_export/EXPORT-NOTES.md).

All patient data in this repository is synthetic. No real person appears in it.

## Setup

Requires Node 22, npm and Docker. Every step below is a command; there are no manual steps.

```sh
git clone <this repository> && cd wellis-pim-take-home
npm ci
cp .env.example .env        # DATABASE_URL for the compose database (host port 55432)
npm run db:up               # starts Postgres 17 and waits until it is healthy
npm run db:migrate          # applies the migrations under drizzle/ (see docs/schema.md)
npm run seed:reviewers      # the care team from REVIEWERS in .env (ADR-0014)
npm run dev                 # http://localhost:3000
```

In a second terminal:

```sh
curl -i http://localhost:3000/api/health
```

Expected: `HTTP/1.1 200 OK` with body `{"status":"ok"}`. With the database stopped
(`docker compose stop`) the same call answers `503` and `{"status":"unavailable"}`.

The compose database listens on host port `55432`, not `5432`, so a Postgres already
installed on the machine cannot shadow it.

### Checks

```sh
npm run db:up               # the integration tests need the compose database
npm run check               # typecheck, lint, format check, unit tests, integration tests
```

The integration tests fail if `DATABASE_URL` is unset. Each test file creates, migrates and
drops its own database named `wellis_test_<file>`, so the `DATABASE_URL` role needs `CREATEDB`
(the compose and CI users are superusers), and the host must be local unless
`ALLOW_REMOTE_TEST_DATABASE=1` is set. The
individual steps are `typecheck`, `lint`, `format:check` (`format` rewrites), `test` and
`test:integration` in `package.json`. CI (`.github/workflows/ci.yml`) runs `npm run check`
against a Postgres service container, then `npm run build`.

## Import

```sh
npm run import -- --as-of 2026-09-08            # loads legacy_export/ and writes reports/
npm run import -- --as-of 2026-09-08 --dry-run  # same run, rolled back; prints the report, writes no file
```

**The import report is [`reports/import-report.md`](reports/import-report.md)**, rendered from
[`reports/import-report.json`](reports/import-report.json), which the command produces by counting
the database the run left behind. Read that file for what came in, what was cleaned, what was
quarantined, the rules and assumptions, and what `EXPORT-NOTES.md` did not warn about (R-A18 to
R-A23).

One run reads the three files, stores every row byte-faithfully in the `legacy_*_raw` tables,
maps them into the canonical tables by the rules of ADR-0005, writes a normalisation record for
every value that differs from raw, merges the duplicate patient records that are literally
identical, derives each patient's consent state, evaluates every legacy intake against the current
ruleset in shadow, and raises review items for everything it cannot decide safely.
Everything after the `import_runs` row happens in one transaction: a run that fails writes
nothing else. `--as-of` is the reference date for every "future" judgement (a birth date after
it is impossible) and is stored on the run so it is reproducible; it is required, never the
clock. The command prints the counts per rule code, per field, and per review-item type and
scope. Those printed numbers are the only source for any figure quoted about the import; none is
typed by hand. Running the command twice changes no table but `import_runs`
(`src/import/run.integration.test.ts`). The rule set the importer applies lives in
`rules/v1.json`; the codes and their evidence in `src/import/mapper/rule-codes.ts`; the
conventions in ADR-0009 and ADR-0011.

The report is a statement about the **export**, not about the run: it carries `--as-of`, the
importer version and the ruleset version, and no run id and no wall-clock, so two runs over one
export render byte-identical files and a diff of the committed report is a change in the data or
in the rules (ADR-0011 item 14). The run keeps the link through `import_runs.report_path`; a dry
run prints the same report and leaves that column null.

### What one run over `legacy_export/` does

| | |
|---|---|
| raw rows stored | 2466 patients, 2917 intakes, 2643 consent events |
| normalisation records | 13856 over 19 rule codes |
| duplicate-patient candidates | 70 groups, all pairs: 28 tier 1, 3 tier 2, 39 tier 3 |
| merged by the importer | 28 pairs, 0 fields taken from a loser, every legacy id still resolving |
| consent states derived | 2438, one per surviving patient |
| shadow evaluations | 2917, one per legacy intake: 2304 cleared, 331 flagged, 254 rejected, 28 not evaluable |
| review items raised | 336 |

Every number above is printed by the command and appears in `reports/import-report.json`; none is
typed by hand. Two consecutive runs change
no table but `import_runs`, merges, derived states and shadow evaluations included.

**Identity.** Four exact keys — canonical email, bsn, E.164 phone, folded name with date of birth —
group the candidates, and only a group that is literally identical on identity and non-contradictory
on everything else is merged (`CLAUDE.md` §5's one exception). A merge writes `merged_into` and the
alias rows and nothing else: `consent_events` can never be updated (ADR-0007), so a patient's
records are read through the membership function of `src/repo/membership.ts`, which walks
`merged_into`. That makes every merge reversible by writing the same two things back, which
`unmergePatient` does; there is no console for it yet.

**Shadow evaluation.** Every legacy intake is evaluated with the ruleset the console would apply
today, stored in `eligibility_evaluations` with `shadow = true`, and **nothing is applied** — each
intake keeps the state its legacy outcome gave it. Queueing those disagreements would be wrong: the
doctor who approved a 2024 intake saw its BMI. They are report figures instead (191 below 27, 283
in the band without a weight-related condition, 70 under 18). Items are raised only where the
legacy process could not see the problem — a GLP-1 medication (42) or a thyroid-cancer or
pancreatitis history (15) buried in free text — or where it is a legal one: 58 approved or pending
intakes from someone under 18.

## Eligibility

`evaluate(input, ruleset)` in `src/eligibility/` is the whole rules engine: a pure function with
no I/O, no database and no clock, holding no threshold or term of its own. Thresholds, the two
clinical term lists, the weight-related list and the precedence statement all come from
`rules/v1.json`, which the schema validates at load, so the ruleset version stored with an
evaluation is enough to reproduce it. One function serves both callers — the Part B intake flow and the import-time history audit,
which calls it over every legacy intake.

Every rule is evaluated — nothing short-circuits — and precedence resolves afterwards: age under
18 rejects outright, while any other reject yields to a flag so that a human decides.
ASSIGNMENT.md §3B gives six rules and no precedence; this is QUESTIONS.md Q1's documented
default, recorded in ADR-0010, and it lives in the ruleset file, so changing it is configuration.
Each matched rule contributes one reason string in a five-prefix grammar — rejected, flagged, not
evaluated, note, cleared — and the result carries the age, the metrics, the unrounded BMI and the
matched terms, so an evaluation explains itself. A missing age, weight or height never clears a
patient silently: the rule that needed it does not fire, a line records what was missing, and an
evaluation that matched no rule is `not_evaluable` rather than cleared — a fourth outcome, which
the state machine does not take, alongside the three the intake states are named after.

Free text can add a flag but never clear one: the GLP-1 and thyroid-cancer/pancreatitis lists
also read the intake's free-text answer, while the weight-related list — the only one that
suppresses a flag — reads the structured answer only. Matching is split, tokenise, contiguous
run, never a bare substring, so `hypothyreoidie` is not thyroid cancer and `levothyroxine` is not
a GLP-1. Over the legacy export the matcher reproduces the counts ADR-0005 was accepted with.

## Intake

```sh
npm run dev                 # http://localhost:3000/intake
```

Five steps — consent, identity, height and weight, medication, conditions — each saved to the
server as it is answered, so the draft is a row in `intakes` with `state = 'draft'` from the first
question. Consent comes first because it is permission to process everything that follows
(ADR-0019): a patient who does not agree is refused at the first screen, and no row, no audit entry
and no answer is written — so an abandoned draft holds a grant and its text version, and no
personal data at all.

Nothing on the client decides anything: every message the patient sees under a field is the
server's own, from the Zod schema at the boundary, and the plausibility bounds and the condition
and GLP-1 checklists are read from `rules/v1.json`, so the form cannot disagree with the engine
about what is valid or about what counts as a weight-related condition.

Submitting is one transaction: it creates the patient (`prospect`), fills the intake, stores the
evaluation with `shadow = false`, writes the consent event, moves the intake `draft → submitted →
auto_*`, and runs two detectors. Consent is an explicit grant naming the version of the text the
patient was shown (`v3`, the next in the sequence the export already uses); without it submit is
`400` and **writes nothing at all**. What the patient typed is kept verbatim in `intakes.answers`,
and every difference between that and the canonical patient row — a trimmed name, a lowercased
email — has a normalisation record, produced by the importer's own normalisers.

**The two detectors never block and never merge.** A submission sharing a candidate key with an
existing patient raises a `POSSIBLE_EXISTING_PATIENT` review item and the intake carries on through
the machine; whether two people are one person is a reviewer's decision and not worth making a
patient wait for. A patient who reports current GLP-1 use and names a drug the ruleset does not
know is flagged anyway — the yes/no answer is an engine input, so R-B6(d) holds whatever they call
it — and a single `vocabulary` item asks whether to add the name in v2, once however many patients
name the same drug.

### The state machine

Ten legal ordered pairs over twelve states, in `src/intake/machine.ts` (ADR-0014):

```
        → draft → submitted → auto_cleared ⟍
                            → auto_flagged  →  in_review → approved
                            → auto_rejected ⟋              → rejected
                          legacy_pending ⟋
```

`transitionIntake` is the only code that writes `intakes.state`, and it writes the audit entry —
actor, timestamp, from, to, reason, and the ruleset version on the engine's edges — in the same
transaction. It is enforced **twice**: the pure table refuses an illegal pair, and a trigger on
`intakes`, generated from that same table, refuses one from `psql` (R-B15, R-B16). Both are tested
over the whole 144-pair grid: 10 accepted, 134 refused by the function, 110 by the trigger, which
additionally allows an intake to stay put, and the importer to re-map one legacy state to another.

`in_review` is entered only when a named reviewer claims the intake — never automatically — which
also makes claiming exclusive, since `in_review → in_review` is not an edge. `approved` and
`rejected` need role `doctor`, and `approved` is refused outright when the intake's evaluation
matched an absolute reject: an under-age intake cannot be approved by anyone, which is why Q1 calls
that rule absolute in the first place.

### Deliberate scope cuts

Each is a decision, not an omission (R-S4):

- **No authentication of any kind.** A patient holds their intake's uuid; a reviewer asserts who
  they are. `audit_entries.actor_reviewer_id` is the stable identity real auth would slot into, and
  `reviewers` is seeded from the environment. Q8's documented default.
- **The review console is not built on this branch** — no work queue, no conflict resolution, no
  patient detail view, and no route offers the reviewer edges of the machine, although the edges
  themselves are implemented and tested.
- **An abandoned draft stays forever**, as a `draft` row with partial answers and no patient. No
  expiry is built.
- **Roles are recorded but not authorised beyond the two edges above**, and reviewer identity is
  asserted rather than proven, so the role separates duties; it does not resist an attacker.

## Deploy

The app runs on Vercel against Supabase-hosted Postgres, used only through its Postgres
connection string (ADR-0003). `DATABASE_URL` in the Vercel project is Supabase's **pooled**
connection string (transaction mode) with `?sslmode=require` appended: TLS is a property of
the database, so it is requested in the URL and postgres-js reads it from there; the compose
URL carries no `sslmode` because that database has no certificate. The client in
`src/db/client.ts` is configured for the pooler: prepared statements are off because the
transaction-mode pooler does not support them, and each function instance holds a pool of at
most 5 connections and drops idle ones after 20 seconds.

Migrations run through the **session** pooler (port 5432), because the transaction pooler does
not support the session-level features drizzle-kit needs. `MIGRATION_URL` is that URL: the same
role and the same secret as `DATABASE_URL`, read by drizzle-kit only, and unset locally and in CI
where one URL serves both (ADR-0008). The production database is seeded by running the importer
(`npm run import`, Part A) with `DATABASE_URL` pointed at whichever pooler fits.
