# ADR-0013: Where the import report gets its numbers

- **Status:** accepted
- **Date:** 2026-09-12
- **Deciders:** Andrei Andreev
- **Requirements:** R-A18 to R-A23, R-A15, R-A16 · **Amends:** ADR-0011 item 14 (adds where the
  numbers come from, to what that item already fixed about what the report is a statement about)

## Context and problem statement

ADR-0011 item 14 settled what the import report *is*: a statement about the export, carrying
`--as-of`, the importer version and the ruleset version and no run id and no wall-clock, so two
runs over one export render byte-identical files. It did not settle where each number comes from,
and the report branch found that the obvious answer — "count the database after the run" — is
wrong in two places and impossible in a third.

A report built after the run cannot describe a `--dry-run`, whose transaction is rolled back: it
would count an empty database and print a file of zeros as if it were true. Two figures are not a
count of any column: the rules that fired over the legacy intakes (`eligibility_evaluations` stores
the verdict, the reasons and the inputs, but not `matched`, and ADR-0011 item 21 forbids
re-deriving it from the thresholds), and the consent state of a legacy row a merge took away
(`consent_states` holds surviving patients only, by ADR-0011 item 13). And `review_items` has no
`rule` column at all: the rule lives inside `dedupe_key` and nowhere else.

## Decision drivers

- Every number in the report is produced by code and reproducible with one documented command
  (`CLAUDE.md` §5), and a figure a reviewer is shown must not depend on row order (ADR-0012).
- A dry run prints and writes nothing (ADR-0009 item 6) — and what it prints must be true.
- One implementation of a rule. A report that recomputes a derivation is a second copy that can
  disagree with the one that decides (ADR-0011 item 21, `CLAUDE.md` §2 DRY).
- Anything that is not a plain count says so where it is built, and a test proves it from the
  other side (`CLAUDE.md` §4: verify, never assume).
- No schema change for the report's convenience: a column exists because the domain needs it.

## Considered options

1. Build the report inside the run transaction, from queries against the tables the run has just
   written, with the two non-count figures passed in and named.
2. Build it after the run, from the committed database, as a separate command.
3. Build it from the in-memory `ImportSummary` the run already returns.

## Decision outcome

Chosen option: **Option 1**.

| # | Question | Decision |
| --- | --- | --- |
| 1 | When the report is built | **Inside the run's transaction**, as its last step, and returned on `ImportSummary`. A dry run therefore reports the database it would have left behind and still writes nothing, which is the only reading of "a dry run prints the report" that is not a lie. Rendering and writing stay at the edge: `runImport` never touches the filesystem, and the CLI writes `reports/import-report.json`, renders the Markdown from it and stamps `import_runs.report_path`. |
| 2 | The two figures that are not counts | Passed in and named in the JSON's own documentation. The **per-rule hits** come from the engine's `matched` (ADR-0011 item 21) because no column stores it; the **consent states per legacy row** come from `deriveConsentStates` applied to each row's own events, because a merged-away row has no state of its own and a second SQL derivation would be a second reading of the log. Both are functions of (export, ruleset) like every other figure, so neither weakens the byte-identical property. Each is cross-checked in `report.integration.test.ts` from the other side — the rule hits against the reason lines the same evaluations stored, the per-row states against the two tables they must account for. |
| 3 | How items are grouped by rule | The rule is **read back out of `dedupe_key`** with `dedupeParts`, the exact inverse of the function that wrote it, unit-tested for round-tripping including the escaping. `review_items` gains no `rule` column: the rule is already part of the key that makes an item unique (ADR-0004), a column would be a second copy that can drift, and the console can read it the same way. |
| 4 | What `import_runs.report_path` holds | The **JSON** path. It is the machine-readable statement; the Markdown is rendered from it and sits beside it. Null stays null for a dry run. |
| 5 | The Markdown | A **pure function of the JSON** (`renderMarkdown`), with no I/O, no clock and no access to the database, so the two committed files cannot disagree and either can be regenerated from the other's source. Tested as a pure function on a fixture, with no database. |
| 6 | A figure that disagrees with an accepted count | **Reported with its definition, never tuned.** The report states the definition it counted under, and where an earlier count was read differently, both readings appear: the intakes submitted before a patient's first grant are 68 under "a submission date the mapper could read, compared in Europe/Amsterdam days", and the profiling session's 71 is that figure plus the 3 intakes whose date the mapper nulled as impossible (70 patients, likewise, is 68 + 2). |

### Consequences

- Good: `npm run import -- --dry-run` prints a true report of a database that is then rolled back,
  which is what makes the flag useful for checking a new export before writing anything.
- Good: the report needs no schema change, and the two figures it cannot count are visible as such
  rather than buried.
- Good: a diff of `reports/import-report.json` between two commits is a change in the export or in
  the rules, and the test that renders two runs proves it.
- Bad: `buildReport` runs inside the transaction, so its queries are part of the run's duration and
  a failure in it fails the whole import. Accepted: the report is a deliverable of the run
  (R-A18), and an import whose report cannot be built is an import we would not trust.
- Bad: the report reads `review_items.dedupe_key` as structured data, which makes the key's shape
  a contract rather than an opaque string. Mitigated by `dedupeParts` being the inverse of
  `dedupeKey` in the same module, with a round-trip test.
- Neutral: the report describes the whole database, not one run, so a human resolving items or
  unmerging a pair changes it. That is correct — it states what is there now — and is why the
  identity section counts the pairs a human decided separately.

### Confirmation

- `src/import/report/report.integration.test.ts`: every figure equals its `SELECT count(*)`; the
  rule hits equal an independent reading of the stored reason lines; the two consent-state tables
  account for each other to the row; a second run renders byte-identical JSON and Markdown.
- `src/import/report/render.test.ts`: the Markdown is deterministic, changes when a number in the
  JSON changes, and names no run and no clock.
- `src/import/review/review.test.ts`: `dedupeParts(dedupeKey(parts))` round-trips, escaping
  included, and `ruleOf` refuses a key that names no rule.
- `src/import/run.integration.test.ts`: a dry run leaves `import_runs.report_path` null.

## Pros and cons of the options

### Option 2 — build it after the run, as a separate command

- Good: the report is a pure function of the committed database and can be regenerated at will.
- Bad: it cannot describe a dry run at all, and a second command is a second thing to remember and
  a second way for the committed file to fall out of date with the database.

### Option 3 — build it from the `ImportSummary`

- Good: no queries at all; the numbers are already in hand.
- Bad: the summary counts what the run *did*, not what is *there* — a second run inserts nothing
  and would report an empty import — and nothing would then check the writes against the reads.

## More information

- ASSIGNMENT.md §3A item 4 (the report), `REQUIREMENTS.md` R-A18 to R-A23.
- ADR-0011 items 11, 13, 14, 21 and 22; ADR-0012 item 5; ADR-0009 item 6 (the dry run).
- `reports/import-report.md` is the rendered result over this export.
