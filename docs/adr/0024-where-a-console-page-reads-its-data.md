# ADR-0024: Where a console page reads its data

- **Status:** proposed
- **Date:** 2026-09-13
- **Deciders:** Andrei Andreev
- **Requirements:** R-T4, R-C1, R-C9, R-T7 · **Amends:** ADR-0003 ("No React component imports the
  data layer") and the sentence `CLAUDE.md` §8 states it in

## Context and problem statement

Two sentences in the repository say who may talk to the database, and this ADR replaces both.

> **ADR-0003, Decision outcome:** "Next.js App Router: React Server Components for read views,
> client components only where interaction needs them; API as Route Handlers under `app/api/**`.
> **No React component imports the data layer.**"

> **`CLAUDE.md` §8, Stack:** "one deployable that serves the React review console, the patient
> intake flow, and the API as Route Handlers. **The API is the only database client (R-T4); React
> components never import the database layer.**"

Until now nothing tested either — the home page renders text, the intake page reads
`rules/v1.json`, and the patient's form is a client component that talks to route handlers over
`fetch`. The console is the first part of the product whose **pages** are the data.

R-T4 itself says something narrower and sharper: "All business logic **MUST** live in my own API.
The client **MUST NOT** talk to the database directly (no rows-over-REST)." A React Server
Component runs on the server, in the same process as the route handlers, and sends the browser
HTML. Under R-T4 it is not "the client"; under ADR-0003's sentence it is "a React component".

The two readings give different code. Followed literally, every console page would `fetch` its own
API over HTTP — which needs an absolute origin the page does not know, the reviewer's session
cookie forwarded by hand into a request the server makes to itself, and a JSON round trip whose
types are re-declared on both sides. That is slower, more brittle and harder to test than the thing
it is protecting against, and it protects against nothing: the browser never sees a row either way.

## Decision drivers

- R-T4 as written: the **browser** never queries the database, and no endpoint serves rows for a
  client to assemble business logic from.
- Tests where correctness matters (R-T7, R-T8): whatever holds the query is what a test should be
  able to call.
- KISS (`CLAUDE.md` §2): a server calling itself over HTTP to reach its own process is a moving
  part with no reader.
- One writer, and one place a write can be refused (ADR-0021, ADR-0023).

## Considered options

1. **Pages read through repository functions; every write is a route handler.**
2. **Pages `fetch` the console's own API**, as ADR-0003's sentence reads literally.
3. **Pages hold SQL of their own**, the fastest to write and the hardest to test.

## Decision outcome

Chosen option: **Option 1**. The two sentences quoted above are replaced by these four:

1. **Route handlers are the only writers.** Every mutation in the product is a route handler under
   `app/api/**`. Nothing else writes — not a page, not a server action, not a client component.
   That is where the session, the actor, the role gate and the 401/403 contract live (ADR-0021),
   and a route handler is a function from a `Request` to a `Response` that a test calls with no
   browser and no rendering.
2. **Server components and route handlers read through `src/repo/`.** Both are the server. Both
   call the same repository layer — the one `mergePatients`, `membersOf`, `queuePage` and
   `resolveReviewItem` already live in — so the thing a test calls is the thing the screen shows.
   Neither writes SQL of its own.
3. **The browser reaches data only through routes.** A client component holds no database import
   and no business rule; it posts to a route and renders what comes back, as `IntakeForm` already
   does. No endpoint serves rows for a client to assemble business logic from.
4. **No page imports `drizzle-orm` or `@/db/schema`**, and a test asserts it over every file under
   `src/app/` (`src/app/pages.test.ts`). A page that needs a number a repository function does not
   return gets a function, not a query.

R-T4 is satisfied in full and unchanged: the client does not talk to the database, and no business
logic lives outside the server. What the old sentences got wrong is only *which process* a React
Server Component runs in. They were written before any page had data, and followed literally they
would buy nothing at a real cost.

`CLAUDE.md` §8 is reworded on this branch to item 2's reading, so the document and the code agree
rather than needing a reader to know which one won.

### Consequences

- Good: one layer holds every query, and it is the layer that already holds the writes and the
  tests.
- Good: no origin to configure, no cookie to forward from the server to itself, no duplicated
  response types.
- Good: a page is a renderer. The console's logic is testable without rendering anything.
- Bad: a server component can now reach the database, so a future page could put a query in
  itself. Mitigated by review and by the rule being stated here in one line: pages call `src/repo/`.
- Bad: there is no HTTP endpoint for the queue, so a reader of the repository cannot curl it.
  Accepted: the screens are the deliverable, and the mutations — which is what a reviewer would
  want to script — are all routes.
- Neutral: nothing changes for the patient's intake flow, which is a client component talking to
  route handlers and stays that way.

### Confirmation

- `src/app/pages.test.ts` asserts that no file under `src/app/` imports `drizzle-orm` or
  `@/db/schema`, and that no page fetches the console over HTTP.
- Every console **mutation** is a route handler with an integration test that calls it directly and
  asserts 401 without a session (ADR-0021).
- The queue's counts and rows are tested against the repository function, not by rendering a page.

## More information

- ADR-0003 (the sentence this amends, and the **Amended by** pointer added to it), `CLAUDE.md` §8
  (reworded on this branch), ADR-0021 (where a write is refused), ADR-0023 (one resolution path),
  `REQUIREMENTS.md` R-T4, R-C1.
