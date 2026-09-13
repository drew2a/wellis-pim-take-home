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
cp .env.example .env        # DATABASE_URL for the compose database (host port 55432), then put
                            # a CONSOLE_SECRET of your own in it — it is required and unset here
npm run db:up               # starts Postgres 17 and waits until it is healthy
npm run db:migrate          # applies the migrations under drizzle/ (see docs/schema.md)
npm run seed:reviewers      # the care team from REVIEWERS in .env (ADR-0014); the console's
                            # /login lists exactly these people
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
`rejected` are open to any reviewer (ADR-0027), and `approved` is refused outright when the
intake's evaluation matched an absolute reject: an under-age intake cannot be approved by anyone,
which is why Q1 calls that rule absolute in the first place. That refusal, not a label on a person,
is the one thing standing between a minor and an approval.

## Part C — the review console

`/console`, behind `/login`. Three panes (ADR-0028): a dark rail of every kind of open work with its
count, the queue, and the piece of work that is open — so deciding an item never costs a reviewer
their place in the list. One queue combines both sources of work, the review items the import could
not decide and the intakes waiting for a person, oldest first. On this export that is **340 open
items and 6 flagged intakes**, with every count taken from the database rather than from the page.

The filters are the URL: the rail's kinds, the scope (open / resolved / dismissed) and the age are
query parameters, so a filtered queue survives a reload and can be kept in a tab. `j` and `k` move
down and up it, and the key printed on each decision button also takes it. The design is the repo
owner's, recorded in [`docs/design/`](docs/design/).

Every kind of item has a screen and a decision:

| item | open | the decision |
|---|---|---|
| `clinical_history` | 115 | what was done about something the legacy process could not see; **the outcome never changes** |
| `consent` | 83 | what was done outside the system; for the 7 self-contradicting logs, the state a person established (ADR-0025) |
| `data_quality` | 62 | accept the detector's proposal, type a value, or leave the null |
| `identity_conflict` | 44 | merge with a survivor and a value per field, or "not the same person" |
| `orphan_intake` | 21 | attach to a patient found by search, or leave unresolved |
| `vocabulary` | 10 | confirm or reject the inference; for the 18 unit-less weights, apply it row by row |
| `duplicate_intake` | 5 | which of a same-day pair is the record of note; **both rows stay** |

An intake is claimed (`in_review`, with the reviewer's name on it) and then approved or rejected by
a doctor with a note. The patient's page shows the record, everything the membership function says
belongs to it, and the audit timeline that explains how it got there.

Two properties hold by construction rather than by review:

- **One writer.** Every value that changes after the import goes through `resolveReviewItem`, which
  writes the value, the audit entry with actor and note, and closes the item in one transaction.
  The merge is the single deliberate exception, for the reason ADR-0022 gives.
- **The actor is never sent by the caller.** It comes from the session, and no route schema
  declares a reviewer or an actor, so there is no path from a request body to an audit entry.

### Deliberate scope cuts

Each is a decision, not an omission (R-S4):

- **No authentication of the patient.** A patient holds their intake's uuid, and that uuid is the
  only thing that authorises a read of their own intake.
- **One shared secret for the console, not real authentication** (ADR-0021). `/login` takes the
  secret from `CONSOLE_SECRET` and a reviewer picked from the seeded `reviewers` list, and sets a
  signed, httpOnly session cookie; `currentReviewer()` is where every console page and every
  mutating route gets its actor, so an audit entry's actor is never a value the caller sent. What
  this does **not** do: it does not prove who the person is. Anyone holding the shared secret can
  pick any name on the list. There is no registration, no password reset, no per-reviewer
  credential, no lockout and no audit of failed logins. **A real deployment plugs SSO in here**,
  against `audit_entries.actor_reviewer_id`, which is already the stable identity.
- **An abandoned draft stays forever**, as a `draft` row with partial answers and no patient. No
  expiry is built.
- **No unmerge screen.** `unmergePatient` exists, is the exact inverse of a merge and is tested;
  nothing in the console calls it. A merge taken back is rare enough to be worth a deliberate act
  through the API.
- **Sorting is by age only**, and there are no saved filters. The filters are the URL, so a
  filtered queue can be kept in a tab, which is most of what saved filters would buy. The queue's
  own text box and its oldest/newest toggle narrow and reverse **the page already on screen** — they
  are not a second query, and the header says how many of the page they left.
- **There is no "Mine".** The console design offers it as a third scope; nothing owns an item —
  roles were removed in ADR-0027, and claiming an intake writes an audit entry rather than an
  assignment — so the three scope pills are the three real statuses instead. A pill that filtered on
  nothing would be worse than an absent one.
- **The rail lists the kinds; it is not a menu of screens.** Patients, intakes and import runs have
  no list screens. A patient's record is reached from the item or intake that names it, and the
  import run is the report in `reports/`.
- **No bulk actions**, except the row-by-row exclusion on a vocabulary item — which is not a bulk
  action but the opposite: one decision, applied to the rows a person kept.
- **The queue shows a page, not everything.** 500 rows, oldest first, which is the whole of the
  default view; a filter that selects the 2068 legacy approvals says it is showing a page.
- **A reviewer has no role, and the console enforces no permissions** (ADR-0027). Approving and
  rejecting were once gated on a `doctor` role; with one shared secret and the name picked from a
  list, that gate refused nobody who wanted to pass it, so it was removed rather than left to imply
  a guarantee the login page cannot keep. What still closes an approval is the intake's own
  evaluation — Q1's absolute age reject — which refuses every reviewer alike. Real permissions
  arrive with real identity, and `currentReviewer()` is the one seam for both.
- **A correction does not re-run the shadow evaluation it invalidates** (ADR-0026). Today's rules
  are run over every legacy intake at import and stored with the inputs they judged — age at
  submission, weight, height. A reviewer correcting one of those inputs leaves that stored verdict
  standing on inputs that have changed, so the shadow outcome and the record can disagree until the
  next import. Not built because it is three decisions and not one: deriving the engine's inputs
  from canonical rows rather than from the importer's mapped structures, loading a *named*
  `ruleset_version` where `loadRules` takes a filesystem path, and settling whether a correction
  re-evaluates history at all — ADR-0005 says shadow rows are browsable and never applied. The
  console shows the ruleset version next to every shadow verdict, so a stale one is at least
  attributable.
- **A merge asks only about the fields that contradict** (ADR-0028 §5). The picker is two columns,
  survivor on the left and checked by default; a field both records hold the same value in is shown
  rather than offered, so the one field that disagrees is not buried under nine that do not. The
  cost is that a value both rows agree on cannot be retyped from the merge screen — that is a
  `data_quality` decision, and it has one.
- **A merge joins two records at a time.** An identity item comparing three or more — reachable
  through the new flow; there are none in the export — is decided one pair at a time, and the
  records not in that merge are left exactly as they are (ADR-0026 item 3).

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
