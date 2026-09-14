# ADR-0030: A stale payload key goes with the rebuild, not with a migration

- **Status:** proposed
- **Date:** 2026-09-14
- **Deciders:** Andrei Andreev
- **Requirements:** R-A15, R-C5 · **Supersedes:** two claims in the *What changes* section of
  [ADR-0029](0029-an-orphan-intake-has-no-identity-to-match-on.md) — that a later import overwrites
  a payload written before it, and that the leftover key is inert. The decision of ADR-0029 —
  remove the look-alike block from the payload and from the screen — stands unchanged.

## Context and problem statement

The pre-merge review of `fix/orphan-look-alikes` found that two sentences ADR-0029 writes about
already-stored payloads are false against the code.

**"Payloads already in the database keep their `look_alikes` key until the next import overwrites
them."** No import overwrites them. `insertReviewItems` ends in
`.onConflictDoNothing({ target: reviewItems.dedupeKey })` (`src/import/review/items.ts:122`), and
ADR-0029 states in the same section that the `dedupe_key` is untouched, so the 21 orphan items are
the same 21 items across a re-run. A re-import therefore inserts nothing for them and writes
nothing over them. The key survives **every** later import, not merely until the next one. That is
the idempotency ADR-0004 and ADR-0008 asked for (R-A15) — a re-run does not re-open a resolved
item — working exactly as designed.

**"It is inert: nothing reads it after this change, and the screen renders `payload` through an
explicit list of keys."** The screen renders `payload` through a **denylist**: `evidenceOf()` in
`src/app/console/items/[id]/page.tsx` dropped three keys (`rows`, `actions`, `note`) and rendered
every other key of the payload. On a database seeded before this change, the *"Patients that look
like this one"* card is gone, and the same shortlist of candidate patients reappears one card
lower, in *as the export gave it*, as a folded JSON array — now without even the banner and the
caveat ADR-0029 judged insufficient. Not inert: strictly worse than what ADR-0029 removed.

## Decision drivers

- **`CLAUDE.md` §5: every number and claim is backed by what the code does.** An accepted ADR
  asserting behaviour the code does not have is the same defect as a wrong number in the report.
- **The stale data exists in exactly one place** — a developer database, and a Vercel/Supabase
  deployment, both seeded by a run of the importer that predates this branch.
- **YAGNI (`CLAUDE.md` §2).** A migration is machinery that ships, gets read, and has to be
  explained in the follow-up.

## Considered options

1. Filter the key on the screen; let the rebuild remove the data.
2. Add a migration — `jsonb - 'look_alikes'` over `review_items where type = 'orphan_intake'` —
   and filter the key as well.
3. Migration only, no filter.

## Decision outcome

Chosen option: **1 — filter the key on the screen, and let the stale data go with the rebuild**,
because the deployed database is rebuilt from an empty schema before submission and a fresh import
cannot produce the key, so a migration would run over zero rows on every install a reviewer or a
future deployment will ever make.

`look_alikes` joins the keys `evidenceOf()` leaves out, with the reason written where the next
person to add a payload key will read it.

The comment there also states the rule the denylist depends on, which is the actual defect the
review found: **a payload is safe to render whole because it is written already masked.**
`mapping-items.ts` masks the bsn as the review item is built, not as it is shown — `review_items.
payload` is `jsonb`, which the console's column-level masking cannot reach into (ADR-0009,
`review.test.ts` *"masks the bsn in the payload and digests it in the dedupe key"*). A key added to
a payload tomorrow reaches the reviewer's screen whether or not anyone decided it should; the
obligation is at the write end. That is how `look_alikes` came back after being deleted, and
naming it is worth more than the one key this ADR removes from view.

The rule has one deliberate exception, and **paying its debt is the second half of this decision.**
**ADR-0009 item 9** (`SOURCE_KEY_REPEATED`) puts the repeated row into the payload *whole, as
exported, unmasked* — `repeated_row: r.fields` in `repeatedKeyItems()` — because the raw table is
keyed by the natural key, so that row survives nowhere else and a redacted copy would lose it.
ADR-0009 accepts that and assigns the masking to the console: *"the console must mask what it
renders."* The console never did it. `evidenceOf()` would have folded that row onto the screen with
its `bsn` and `phone` readable.

It was latent rather than live — **this export produces zero such items** (`repeatedKeys: 0` in
`reports/import-report.json`; `raw-load.integration.test.ts` covers the builder on a synthetic
repeat) — and it is closed here anyway, because zero is a property of this export and not of the
code, and an unmasked bsn on a reviewer's screen is not a thing to leave loaded for whoever imports
the next export.

The fix is not to hide `repeated_row`: ADR-0009 keeps it deliberately, and hiding it would delete
the only copy of that line from the one screen that can act on it. The fix is `maskedPayload()` in
`src/console/decisions/data-quality.ts`, which runs `repeated_row.bsn` and `repeated_row.phone`
through `maskIdentifier` — **the same helper the item builder uses**, so what is masked at the write
end and what is masked at the read end cannot mean two different things. The rest of the row is
shown as exported: `full_name`, `dob`, `email` and `city` are how the reviewer tells the two
versions of the row apart, and the console already shows them on every other item about this
patient. A `repeated_row` that is not a row of strings throws instead of rendering — failing to draw
a card is recoverable, printing a readable bsn is not.

Everything else passes through untouched, which keeps one rule for the whole card rather than a
per-item-type exception list: identifiers are masked at the write end, and `maskedPayload` is the
one documented place where a payload ADR-0009 exempted is brought back under that rule.

Option 2 was rejected on the rebuild: a `DROP SCHEMA` precedes the migrations, so the migration's
`WHERE` clause matches nothing, forever, on every database anyone creates from this repository. It
would be a permanent statement about a database state that no longer exists anywhere — machinery
to explain rather than protection. Option 3 leaves the denylist unchanged and so leaves the real
defect — an unbounded render of whatever a payload carries next — undocumented and unguarded.

Note that a migration could not have been a `DELETE` or a rewrite of the raw tables in any case:
the evidence tables reject `UPDATE`, `DELETE` and `TRUNCATE` by trigger (ADR-0007). `review_items`
is not one of them, so the `jsonb - 'look_alikes'` update was available; it is declined on the
grounds above, not blocked.

### What changes

- `evidenceOf()` filters `look_alikes` alongside `rows`, `actions` and `note`, through a named
  `NOT_EVIDENCE` set, with the reason for each on it.
- The comment above `evidenceOf()` states that the card is a denylist and that payloads are
  written already masked — the obligation a new payload key inherits.
- `maskedPayload()` is added to `src/console/decisions/data-quality.ts` and is what `evidenceOf()`
  reads: it masks `bsn` and `phone` inside `repeated_row` with `maskIdentifier`, passes every other
  payload through unchanged, and throws on a `repeated_row` it cannot mask. Five tests in
  `data-quality.test.ts` cover the two masked fields, the columns left readable, an absent `phone`,
  an ordinary payload, and the throw. No change to what the importer writes.
- `README.md` § Deploy states the rebuild explicitly: an empty schema, migrations, import, then
  `seed:reviewers`. It previously stated only that the production database is seeded by running
  the importer, which left the claim this ADR rests on unwritten.
- No migration, and no change to any payload already stored. No schema change.

### Consequences

- Good: the shortlist ADR-0029 exists to remove cannot reach the screen on any database, seeded
  before or after this change.
- Good: the rule the evidence card depends on is written next to the card, where the next payload
  key is added.
- Bad: a database seeded before this branch still carries the key in `review_items.payload` until
  it is rebuilt. It is unreachable through the console and is not read by any code
  (`grep -ri "look.alike\|look_alikes" src drizzle` returns nothing), but a direct SQL query finds
  it. Accepted: that database is a development one and will not be the one submitted.
- Good: ADR-0009 item 9's assignment to the console is discharged. The first export that repeats a
  natural key with different values now finds the masking already there, tested, rather than
  finding a note saying someone knew.
- Neutral: no import number moves; nothing is written, so the report is identical. Nothing on a
  screen changes for this export either — it has no such item — so the test is the only evidence
  the masking works, which is why there are five of them.
- Neutral: `sourceDifferences()` masks `bsn` and not `phone` when it writes the `differences` map
  (`MASKED_SOURCE_COLUMNS`), so a repeated row whose phone differs shows that phone in
  `differences` while `repeated_row` masks it. Left as ADR-0009 wrote it: changing what the
  importer stores is a write-end change to an accepted ADR's payload spec, not a rendering fix, and
  the `differences` map is two values of one column rather than a whole identity.

### Confirmation

- `grep -n "look_alikes" src/app/console/items/\[id\]/page.tsx` shows the key on `NOT_EVIDENCE`,
  and it is the only occurrence of it under `src/`.
- `data-quality.test.ts` § *the payload a screen may show* fails if the masking is removed: it
  asserts `bsn: '******782'` and `phone: '*********678'` on a repeated row, and asserts the four
  columns that stay readable — so neither direction can drift unnoticed.
- `grep -rn "\.payload as" src/app/console src/console` returns one line, inside `maskedPayload()`
  itself: the evidence card reaches a payload through that function and nowhere else.
- `npm run check` passes: typecheck, lint, format, schema diagram, unit and integration suites.
- On a database rebuilt from an empty schema, `select count(*) from review_items where payload ?
  'look_alikes'` returns 0 — which is the whole argument against the migration.

## More information

- [ADR-0029](0029-an-orphan-intake-has-no-identity-to-match-on.md) — the decision this one amends
  two claims of.
- [ADR-0004](0004-part-a-schema-and-idempotency.md), [ADR-0008](0008-re-runs-under-immutability-patient-membership-and-provenance.md)
  — idempotency by `dedupe_key`, which is why a re-import does not overwrite a stored payload
  (R-A15).
- [ADR-0009](0009-importer-conventions-blanking-rules-identifiers-actors-dry-run.md) — identifiers
  are masked as the review item is built, the rule the evidence card depends on.
- `README.md` § Deploy — the rebuild this decision rests on.
