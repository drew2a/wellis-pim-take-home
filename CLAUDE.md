# Working rules — Wellis Intake take-home

Rules that apply to every session in this repo. They are binding, not advisory.

Source documents:

- `ASSIGNMENT.md` — the brief. The authority on *what* to build.
- `REQUIREMENTS.md` — the brief restated as numbered RFC 2119 requirements (`R-xx`).
  Cite these IDs in commits, ADRs and tests.
- `QUESTIONS.md` — known ambiguities (`Q-n`) and the default chosen for each until the
  reviewers answer.
- `docs/adr/` — every significant design decision, MADR format. Start every session by
  reading `docs/adr/README.md`; do not re-ask what an accepted ADR already answers.
- `docs/data-profile.md` — what the export actually contains (written in the profiling
  session). Every data rule cites the section that supports it.

## 1. Design decisions are recorded (ADR)

- Any decision that constrains future work, would be asked about in the follow-up, or was
  made under ambiguity **MUST** get an ADR in `docs/adr/`. See `docs/adr/README.md`.
- The agent **MAY** draft an ADR with `status: proposed`. Only the human flips it to
  `accepted`. Never self-accept an ADR.
- Accepted ADRs are immutable — supersede, never edit.
- Do not start implementing a graded decision (schema, merge semantics, states,
  normalisation rules, the auto-fix vs. review boundary) before its ADR exists as at least
  `proposed`.
- Hitting such a decision mid-branch is the normal case: stop, draft the ADR as `proposed`
  on the same branch, and ask — the full lifecycle and mid-branch flow are in
  `docs/adr/README.md` (**Lifecycle**, **ADRs discovered mid-branch**).

## 2. Code writing rules

Adopted from https://github.com/drew2a/ivory-tower — see ADR-0002 for the adoption
decision and the deliberate deviations.

### Principles of design

- **DRY**, **KISS**, **YAGNI**, **SOLID**.
- YAGNI outranks speculative generality: this is a 7-day assignment, not a platform.
  Build the requirement in `REQUIREMENTS.md`, not the requirement's imagined future.
- KISS outranks cleverness. The brief says so explicitly: "Deterministic and explainable
  beats clever" (§3B), and "We care far more about *what your importer notices* than about
  the cleverness of any individual fix" (§3A).
- Dependency inversion where it buys testability — the eligibility engine and the state
  machine **MUST** be pure, I/O-free modules, callable from a test without a database.

### Code style

- [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) is the
  baseline for both frontend and backend.
- Style **MUST** be mechanically enforced (ESLint + Prettier, `strict: true` in
  `tsconfig`), not manually reviewed. No `any`; use `unknown` and narrow.
- Comments explain **why**, not what. Prefer clarifying the code over explaining it.
- Domain vocabulary is fixed — see §6. No synonyms.

### TODO comments

- Format: `// TODO(drew2a): <what>` — all caps, owner in parentheses.
- A TODO **MUST NOT** stand in for a requirement. Anything in `REQUIREMENTS.md` that is
  not built is a scope cut and belongs in `README.md` (R-S4), not in a TODO.

### Tests

- Test where correctness matters, not for coverage (R-T7, R-T8): eligibility engine, state
  machine, gnarliest import logic.
- Every eligibility rule **MUST** have boundary tests. Every illegal state transition
  **MUST** have a test proving it is rejected.
- Tests are the executable form of "what correct means". When a test encodes a decision
  taken under ambiguity, reference the question (`Q-n`) in the test name or a comment.

## 3. Version control

### Commit messages

- **Imperative mood**, as if ordering the codebase to change:
  "add BMI boundary tests", not "added" / "adds" / "this patch adds".
- [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) notation, matching
  the existing history (`chore: ignore IDE configuration files`).
  Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `build`.
- First line ≤ 72 chars, no trailing period. Body explains the problem and why this
  approach — reference `R-xx` / `Q-n` / `ADR-NNNN` where relevant.
- Commit history **MUST** stay real and incremental — never squash the work into one
  commit (R-T10). Commit at each meaningful step; the history is a graded deliverable.

### Branching

- [OneFlow](https://www.endoflineblog.com/oneflow-a-git-branching-model-and-workflow) with
  a single long-running `main`.
- Branch names: `<group>/<slug>`, e.g. `feature/legacy-importer`, `feature/rules-engine`,
  `fix/date-parse-ambiguity`. Slugs replace ticket keys — this repo has no tracker
  (deviation, see ADR-0002).
- Integrate with **rebase + `merge --no-ff`** so each part of the assignment is a visible
  topic in the history.
- Docs-only changes (`REQUIREMENTS.md`, `QUESTIONS.md`, `README.md`, and ADRs that govern
  no code yet) **MAY** go straight to `main`. An ADR that governs code on a branch travels
  with that branch — see `docs/adr/README.md`.

### Review before merge

This repo uses **no GitHub pull requests and no bot reviewers**. Review happens locally, on
the branch, before every merge into `main` (deviation from the source conventions, see
ADR-0002).

1. Every `feature/*` or `fix/*` branch is reviewed before it is merged into `main`.
2. The review runs in a **fresh Claude Code session** — not the one that wrote the code —
   with `/code-review high <branch>`. For changes touching the importer, consent handling,
   the audit log, or authentication it also runs `/security-review`.
3. Every finding is either **fixed on the branch** or **explicitly declined in the review
   session with a one-line reason**. Findings are never left unanswered.
4. The merge is `git merge --no-ff` into `main`, and the merge commit body carries one
   summary line:
   `reviewed: N findings, M fixed, K declined (<reason or ADR ref>)`
5. Docs-only branches (`REQUIREMENTS.md`, `QUESTIONS.md`, ADRs, `README.md`) **MAY** skip
   the review, as already stated for docs-only changes above.

The reviewing session **MUST** cover this checklist: the code is well-designed;
it is appropriately tested; the tests are well-designed; comments explain *why* rather than
*what*; documentation is updated; the code conforms to the style guide.

## 4. Agent conduct in this repo

- **Verify, never assume.** The brief's rule for the dataset ("Assume nothing; verify
  everything", §2) applies to the agent's own claims too: profile the data before
  asserting anything about it, and quote the command output that proves it.
- Never report a requirement as done without the evidence (test output, row counts,
  a report line). Say plainly when something failed or was skipped.
- Do not silently widen scope. Propose, then wait.
- Prefer inline work for small things; use subagents only for genuinely heavy,
  cheap-to-summarise work (broad data profiling, large searches).

## 5. Data invariants

These are the working definition of "correct" for Part A and for every later write to patient data. They apply to the agent's code and to the agent's proposals alike.

- **Raw is kept.** Every legacy row **MUST** be stored as exported, byte-faithful, before anything is interpreted (R-A8).
- **No value changes without a record.** A stored value that differs from the raw value **MUST** have a normalisation record: entity, field, from, to, rule, evidence (R-A7). Trimming whitespace counts. Case-folding counts. Unit conversion counts. There is no such thing as an "obvious" fix that needs no record.
- **Guess only with evidence, and store the evidence.** A rule **MAY** be inferred from the data when it has been tested against the whole export and the test result is written into the rule's record and its ADR. Untested inference **MUST** go to review (R-A10).
- **A review item is a decision, not residue.** If one rule would create hundreds of identical items, that is one vocabulary-level decision for a human, not hundreds of row decisions. Row-level items are reserved for cases where the consequence differs per row.
- **Identity, medicine and consent never auto-resolve** unless the records are literally identical on identity and non-contradictory on everything else. No latest-wins. No most-complete-wins. No merge without a record of which row supplied which field.
- **Legacy data gets the same scrutiny as new data.** Detectors written for the new intake flow **MUST** also run over history and produce review items; they **MUST NOT** rewrite historical outcomes.
- **Audit is append-only.** Every transition and every human decision records actor (human identity or named system process), timestamp, from-state, to-state, reason (R-B20). Audit rows are never updated or deleted. A wrong medication record can hurt someone; a missing audit row hides who let it through.
- **`legacy_export/` is read-only.** Never edit, reformat or "fix" the source files. The importer adapts to the data, never the other way round.
- **Every number in `README.md` and the import report is produced by code**, never typed by hand, and reproducible with one documented command.

## 6. Vocabulary

Fixed terms, used verbatim in code, schema and UI. No synonyms.

- **legacy record** — a row from the export, stored raw. **patient** — the canonical entity we own; one patient may be backed by several legacy records after a merge.
- **intake** — one questionnaire submission, legacy or new. **outcome** — the medical result of an intake (approved / rejected / pending). **status** — the patient's commercial standing (active / paused / churned / prospect). Never conflate the two.
- **consent event** — one granted/revoked line from the log. **consent state** — the derived current standing per patient. The log is evidence; the state is what we act on.
- **normalisation record** — an automatic change we made and can explain. **review item** — a decision we could not make safely and handed to a human. A **conflict** is one kind of review item: two competing versions of the truth shown side by side. Normalisation records and review items are separate tables with separate vocabularies; a value is never both auto-fixed and flagged.
- **ruleset version** — an immutable snapshot of thresholds and term lists that evaluated an intake. **transition** — one audited move of an intake between states. **audit entry** — the record of a transition or a human decision. **actor** — who or what caused it.

## 7. Sessions

Sessions are short and scoped to one block of work. Before ending a session: update the ADR index and any affected docs, run lint, typecheck and the full test suite, commit. The next session starts from the files in this repo, not from memory of this one.

## 8. Stack

Fixed by ADR-0003; change it there, not here.

- **Runtime & language:** Node 22, TypeScript with `strict: true`, npm.
- **App:** Next.js (App Router) — one deployable that serves the React review console, the
  patient intake flow, and the API as Route Handlers. The API is the only database client
  (R-T4); React components never import the database layer.
- **Database:** PostgreSQL. Local via `docker compose`; production on Supabase-hosted
  Postgres, used **only** through its Postgres connection string — no PostgREST, no
  Supabase client SDK (R-T4).
- **Data access:** Drizzle ORM with SQL migrations under `drizzle/`; constraints (unique,
  check, foreign keys) live in the schema, not only in application code.
- **Validation:** Zod at every boundary (API input, CSV/JSONL rows, env).
- **Tests:** Vitest. Unit tests for pure modules (eligibility engine, state machine,
  normalisers). Integration tests for the importer, repositories and API run against a
  real Postgres from the compose file — never against mocks or an in-memory substitute.
- **Quality gates:** ESLint (typescript-eslint strict) + Prettier, `tsc --noEmit`, tests;
  all three run in GitHub Actions with a Postgres service container and locally before
  every commit.
- **Import CLI:** `npm run import` (tsx) loads `legacy_export/` into the configured
  database and writes the report to `reports/`; `--dry-run` prints the report without
  writing.
- **Deploy:** Vercel for the app, seeded by running the importer against the production
  database.
