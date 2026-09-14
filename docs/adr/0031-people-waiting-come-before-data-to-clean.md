# ADR-0031: People waiting come before data to clean

- **Status:** accepted
- **Date:** 2026-09-14
- **Deciders:** Andrei Andreev
- **Requirements:** R-C2, R-C3, R-S4 · **Supersedes:** the sorting half of the *"Age stays"* bullet
  in §3 of [ADR-0028](0028-the-review-console-is-three-panes.md) — "Sorting is oldest-first only (a
  scope cut already recorded in `README.md`), so the toggle reverses the rendered page on the
  client and says so". The other half of that bullet — the canvas's sort toggle does not replace
  the age filter, which is a real query and keeps its pills — stands unchanged, as does the rest of
  ADR-0028.

## Context and problem statement

The queue combines the two sources of work into one list (R-C2): the review items the import could
not decide, and the intakes waiting for a person. ADR-0028 ordered that list by age alone, on the
reasoning that a queue is worked oldest first and that anything more is a scope cut (R-S4).

Age alone does not order these two sources, because they do not measure the same thing. A review
item's age is `review_items.created_at`, which is the moment the importer wrote it — one moment for
the whole export:

```
$ psql -c "select count(*) as open_items, count(distinct created_at) as distinct_ages,
           max(created_at) - min(created_at) as spread from review_items where status = 'open'"
 open_items | distinct_ages |  spread
------------+---------------+----------
        336 |             1 | 00:00:00
```

Three consequences follow, and none of them is what a reviewer means by "oldest first":

1. **The items do not order among themselves at all.** They share one timestamp, so the tiebreak
   `id asc` decides, and a uuid is not an age. The queue looks sorted and is not.
2. **An intake submitted after the import sorts below every one of them.** The import ran at
   `2026-09-14 10:46:39+00` in the database above; a patient who submits at 11:12 is *newer* than
   all 336 items and therefore lands last of 337 rows, at the bottom of a page that shows 500. The
   person waiting for a decision is the one row the reviewer has to scroll past everything else to
   reach.
3. **A re-import moves the whole block.** The items' age is a property of when the importer last
   ran, so it changes under the reviewer without anything about the work having changed.

The count in the rail is not an answer to this. It proves an intake is in the view; it does not put
it where a reviewer looking at the top of the list will see it. The assignment grades what a
reviewer can do in a day (ASSIGNMENT.md §3C), and a queue whose first screen is 500 rows of
same-aged data cleaning while a patient waits below them is the wrong day.

## Decision drivers

- **The two sources are not equally urgent.** A patient who submitted this morning is waiting for a
  decision; a consent gap from 2023 has waited two years and can wait one more hour. That is a
  difference in kind, not in age.
- **Deterministic and explainable beats clever** (ASSIGNMENT.md §3B). Whatever the order is, the
  reviewer must be able to state it in one sentence.
- **The filters are the URL** (ADR-0024); the order is not a filter and does not become one.
- **R-S4:** sorting is still not a feature. This adds one fixed rule to the one order the queue
  has, not a sortable column.
- **KISS** (`CLAUDE.md` §2): one `order by` clause, no priority score, no per-type weighting.

## Considered options

1. **Keep age alone** and rely on the rail's count to tell the reviewer an intake is waiting.
2. **Give review items a truer age** — date each item by the legacy row it came from rather than by
   the import — so that age alone works.
3. **Order by kind first, then age within each kind**: the intakes waiting for a person above the
   review items.
4. **A priority score** per row, combining kind, type and age.

## Decision outcome

Chosen option: **3 — the intakes waiting for a person first, then the review items, each group
oldest first.**

`WORK_FIRST` in `src/repo/queue.ts` is `case when kind = 'intake' then 0 else 1 end` and leads the
existing `order by age asc nulls last, id asc`. One clause, one sentence on the screen, and the
same order for every reviewer on every reload.

Option 1 is the status quo whose three consequences are measured above. Option 2 is the most
attractive of the alternatives and is refused for two reasons: a review item's real age is not in
the export for most types — a `data_quality` item about a malformed row has no date of its own, and
dating it by the row's `submitted_at` would claim the problem was noticed in 2023 when it was
noticed this morning — and more importantly it answers the wrong question. Even with perfect ages,
a consent gap from 2023 would still outrank a patient waiting since this morning, which is exactly
the ordering this ADR exists to stop. Option 4 is the clever one the brief warns against: a score
is a number nobody can predict from the screen, and it would need its own ADR, its own tests and
its own explanation in the follow-up to do what one `case` expression does here.

### 1. The "newest first" toggle flips the age, not the groups

ADR-0028 gave the toggle a one-line implementation — reverse the rendered page — which is now
wrong: reversing the whole page puts the review items back on top, which is the one thing this
order exists to prevent, and makes one button mean two things.

`ordered()` in `src/ui/queue-order.ts` reverses each **run of rows of the same kind** rather than
partitioning the page by kind. The grouping stays the query's to decide and is not restated on the
client: whatever order of kinds the server sends is the order of kinds the reviewer keeps, and the
toggle can only ever change the age within them. It remains a client-side operation on the page
already rendered (ADR-0028 §1: what the queue does on the client is never a second read of the
database).

### What changes

- `src/repo/queue.ts`: `WORK_FIRST` leads the `order by`. No change to what the query selects, to
  the filters, or to the page limit.
- `src/ui/queue-order.ts` (new): `ordered(rows, newestFirst)`, the toggle's behaviour, with the
  `QueueKind` imported as a type from `@/repo/queue` so the two sources of work are named once.
- `src/ui/Queue.tsx`: `QueueItem` gains `kind`, and the toggle calls `ordered()`.
- `src/app/console/ConsoleShell.tsx`: passes `kind`, and the queue's footnote states the order.
- Tests: two integration cases in `src/repo/queue.integration.test.ts` (an old item below a new
  intake; age inside each group), the undated-row case now proves *last of its group* rather than
  last of the queue, and `src/ui/queue-order.test.ts` covers the toggle, including that it never
  moves a row across a group boundary.
- `docs/reviewer-day.md`, `docs/console-stories.md` (S-1) and `README.md` state the order and the
  reason; the `README.md` scope cut is rewritten — it said sorting was by age only and that the
  toggle reversed the page, both of which this ADR changes.

### Consequences

- Good: the first screen of the default view is every person waiting for a decision, and a new
  intake cannot be buried by a data-cleaning backlog however large that backlog grows.
- Good: the order no longer depends on when the importer last ran.
- Bad: the oldest work in the queue is no longer the first row. A reviewer who wants the oldest
  thing of any kind reads past the intakes — on this export at most a few rows, and the count in
  the rail says how many before they start.
- Bad: two groups is a rule that has to be learned. It is written on the screen, in the footnote
  under the queue's header, in the words the ADR title uses.
- Neutral: the items still do not order among themselves (consequence 1 above is not fixed by this
  ADR, only made harmless). Dating an item by the work rather than by the import is the next thing
  to do here, and it is Option 2 as a follow-up rather than as an alternative.
- Neutral: no schema change, no migration, no change to what the importer writes. The order is a
  property of one query.

### Confirmation

- `src/repo/queue.integration.test.ts` § *"puts the intakes waiting for a person above the review
  items, whatever their age"* fails if `WORK_FIRST` is removed: it raises the item long ago and the
  intake today, which is the arrangement age alone gets wrong.
- `src/ui/queue-order.test.ts` § *"leaves the kinds where the server put them, grouped or not"*
  fails if the toggle goes back to reversing the page.
- The three numbers in *Context* are the query printed there, run against the local database after
  `npm run import`.

## More information

- [ADR-0028](0028-the-review-console-is-three-panes.md) — the console's three panes; §3 is the
  bullet this supersedes half of.
- [ADR-0023](0023-console-conventions-one-resolution-path-and-nine-small-decisions.md) item 2 — why
  an imported row's audit timestamps are one moment, the same fact this ADR measures on
  `review_items.created_at`.
- [`docs/reviewer-day.md`](../reviewer-day.md) — the reviewer's day, where the order is stated for
  a reader who is not reading ADRs.
