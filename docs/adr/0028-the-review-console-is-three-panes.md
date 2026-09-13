# ADR-0028: The review console is three panes, and the queue never leaves the screen

- **Status:** accepted
- **Date:** 2026-09-13
- **Deciders:** Andrei Andreev
- **Requirements:** R-C1, R-C2, R-C3, R-C4, R-C5, R-C6, R-S4 · **Amends:** ADR-0018 (extends the
  token block and the `src/ui/` inventory), ADR-0024 (adds where a shell reads its data)

## Context and problem statement

The console shipped as one screen per thing: a queue at `/console`, and a full-page view at
`/console/items/[id]` or `/console/intakes/[id]` with a "Back to the queue" link. Working it means
leaving the list, deciding, and landing back at the top of a list that has changed under you. The
assignment grades what a reviewer can do in a day (ASSIGNMENT.md §3C), and that loop is the part
of the day the screens made worse.

The repo owner supplied a finished design for the console — a Claude Design canvas, extracted to
[`docs/design/review-console.canvas.html`](../design/review-console.canvas.html). It answers the
question this ADR would otherwise have to argue: three panes, the queue always visible, the
decision always in reach at the bottom of the detail pane. `CLAUDE.md` §4 makes reviewer-facing
screen design the repo owner's call, so what is left to decide is not *what it looks like* but
**how it is built without giving up the properties the earlier ADRs bought**: pages read through
`src/repo/` and never hold SQL (ADR-0024), route handlers are the only writers (R-T4), and every
utility class lives in `src/ui/` (ADR-0018).

## Decision drivers

- The queue is the reviewer's place in the work; losing it on every decision is the cost worth
  removing (R-C1, R-C2).
- The filters are the URL, so a filtered queue survives a reload and a bookmark (ADR-0024).
- No screen may offer a control the data cannot answer. A search box that searches nothing, or a
  scope called "Mine" with no owner column behind it, is worse than an absent one.
- KISS (`CLAUDE.md` §2): the console is a list and a form. It does not become a client-side
  application with its own router and cache.
- ADR-0018's boundary holds: classes only in `src/ui/`, tokens only in `@theme`.

## Considered options

1. **A client-side shell.** One route, the panes fetch through the API, selection is client state.
2. **A Next.js layout** at `src/app/console/layout.tsx` holding the rail and the list, with the
   item and intake pages rendering into the detail slot.
3. **A shared server component** each console page composes, passing its own detail content.

## Decision outcome

Chosen option: **Option 3** — `src/app/console/ConsoleShell.tsx`, a server component that every
console page wraps its detail pane in.

Option 1 gives up the properties ADR-0024 bought — the pages stop being server components, the
filters stop being the URL for anything the server renders, and the console grows a second copy of
the state the database already holds — to buy an instant pane swap the queue does not need.

Option 2 is the idiomatic Next answer and it does not work here: a layout receives neither
`searchParams` nor the dynamic params of the route below it. The rail's counts and the list's rows
*are* the search params, and the row to highlight *is* the child's `[id]`. A layout would have to
read both on the client, which is Option 1 through a side door.

Option 3 costs one composition line per page and the queue query on every detail view — 500 rows
capped, one statement, against a page that is already doing several. In exchange every pane stays
a server component reading through `src/repo/queue`, the selected row is a prop rather than a
guess, and the URL keeps meaning what it meant.

### 1. What the three panes are

- **Rail** (`src/ui/Rail.tsx`), dark: the product mark, `Work queue` with its total, then **Open by
  kind** — one entry per review-item type and per intake state, each a coloured dot, a label and a
  count from `queueCounts`, each a link that toggles that kind in the URL. The signed-in reviewer
  sits at the bottom with the way out.
- **Queue** (`src/ui/Queue.tsx`), white: the list, its header, and the only client component in the
  shell. It is given its rows as props by the server; what it does with them on the client is
  narrow the page already rendered — a text filter over patient, title and rule, a sort toggle, and
  `j`/`k` to move — none of which is a second read of the database.
- **Detail** (`src/ui/Detail.tsx`): the header strip (kind, rule, when it was raised, position in
  the queue, ↑↓), the title, the patient line, an optional banner, the evidence, and the decision
  bar pinned to the bottom.

### 2. The decision bar is the reason, and the buttons

Every decision in this console records the reviewer's own words (R-C6), and until now each of the
seven decision components asked for them with its own textarea in its own card. They now share
`DecisionBar` (`src/ui/DecisionBar.tsx`): a mono `REASON` label, one input, and the item's actions
with their key hints. What a decision additionally needs — the fields of a merge, the rows of a
vocabulary item, a patient search, a typed value — stays in the detail body above the bar, because
those are evidence being chosen, not the decision being written.

`NEEDS_A_NOTE` and the disabled-row reason from ADR-0026 survive unchanged: the bar says why it is
unavailable, above the buttons and bound to them for a screen reader.

### 3. Three departures from the canvas, each because the data is not there

The canvas is followed except where following it would mean drawing a control over nothing:

- **"Mine"** is not a scope. `intakes` has no owner column — roles were removed in ADR-0027 and
  claiming records an audit entry, not an assignment. The three scope pills are the three real
  statuses: **Open**, **Resolved**, **Dismissed**.
- **The rail lists every kind, not ten.** The canvas shows ten; the export has seven review-item
  types and twelve intake states, and every one of them is reachable today. The list scrolls rather
  than the filters shrinking.
- **Age stays.** The canvas replaces the age filter with a sort toggle. Sorting is oldest-first
  only (a scope cut already recorded in `README.md`), so the toggle reverses the rendered page on
  the client and says so, and the age filter — which is a real query — keeps its pills.

### 4. Tokens, and two typefaces

`@theme` in `src/app/globals.css` takes the canvas's palette: the near-black ink and the warm-grey
ground, the rail's own darks, the teal accent, the four tag colours, and one hue per kind. Two
families arrive through `next/font/google` — Instrument Sans for text, IBM Plex Mono for the things
that are identifiers rather than prose: ids, rule codes, counts, dates, field names. That
distinction is the canvas's, and it is the one typographic rule this console has.

ADR-0018 is unchanged in substance: the tokens are still one block, the classes are still only in
`src/ui/`, and there is still one light theme.

### 5. A merge asks only about the fields that contradict

The per-field picker of ADR-0022 offered a radio pair and a text field for all ten person fields,
stacked. On the first open item that is thirty controls for one decision, and nine of the ten
fields hold the same value in both records — a choice between `Fleur de Groot` and
`Fleur de Groot`. The picker is now two columns, survivor on the left, and **a field the records
agree on is shown rather than offered**.

The survivor's column is checked before anything is touched, as a preview: that is what the merge
does with a field nobody decides. Where the survivor holds no value and the other record does, the
*other* column is checked instead, because that is the field the survivor gains (ADR-0022 §1). The
preview posts nothing either way — an untouched form sends the same empty `fieldDecisions` it sent
before, so ADR-0022's precedence rule is untouched and the importer's merges are unaffected.

What this gives up: a reviewer can no longer type a replacement for a field **both** records agree
on. R-C5's pick-and-edit survives on every field where the two records disagree, which is the case
the item exists for; correcting a value both rows got wrong is a `data_quality` decision and has
its own screen.

### Consequences

- Good: a reviewer keeps their place. Deciding an item leaves the queue where it was, one row
  further down.
- Good: the counts per kind are on screen without a click (R-C3) and are the database's, not the
  page's.
- Bad: the queue query runs on every detail view. Capped at 500 rows and measured, not assumed —
  see Confirmation.
- Bad: the console is now the widest thing in the product and wants ~840 px. The intake flow, which
  is the patient's screen, is untouched and stays narrow.
- Good: the merge picker drops from thirty controls to the one or two that are a real question.
- Bad: a value both records agree on can no longer be edited from the merge screen (§5).
- Neutral: `src/ui/` grows from nine files to thirteen. `Table` and `PageHeader` stay — the patient
  screen and the intake flow still use them; `Filters` and `Findings` go, replaced by the rail, the
  scope pills and `FindingsCard`.

### Confirmation

- `npm run lint` still fails on a `className` outside `src/ui/`; `grep -rn 'className' src
  --include='*.tsx' | grep -v '^src/ui/'` returns nothing.
- `src/app/pages.test.ts` still asserts no page imports `drizzle-orm` or the schema, and now covers
  `ConsoleShell`.
- A test asserts the shell marks the row whose id is the route's, so "where am I" is rendered and
  not inferred.
- The scope pills and the rail's kind links are the same URL vocabulary `queue-filters.test.ts`
  already covers.

## More information

- [`docs/design/review-console.canvas.html`](../design/review-console.canvas.html) — the design
  this implements, and [`docs/design/README.md`](../design/README.md) for where it came from.
- ADR-0018 (classes and tokens), ADR-0024 (where a page reads its data), ADR-0026 (the console
  review's corrections), ADR-0027 (why there is no role to scope "Mine" by).
