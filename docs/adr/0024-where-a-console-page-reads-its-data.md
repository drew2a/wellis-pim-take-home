# ADR-0024: Where a console page reads its data

- **Status:** proposed
- **Date:** 2026-09-13
- **Deciders:** Andrei Andreev
- **Requirements:** R-T4, R-C1, R-C9, R-T7 · **Amends:** ADR-0003 ("the API is the only database
  client; React components never import the database layer")

## Context and problem statement

ADR-0003 fixed the stack with one sentence about who may talk to the database: "The API is the only
database client (R-T4); React components never import the database layer." Until now nothing tested
it — the home page renders text, the intake page reads `rules/v1.json`, and the patient's form is a
client component that talks to route handlers over `fetch`. The console is the first part of the
product whose **pages** are the data.

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

Chosen option: **Option 1**.

- **Reads.** A console page is a server component. It calls a function in `src/repo/` — the same
  layer `mergePatients`, `membersOf` and `resolveReviewItem` live in — and renders the result. It
  never writes SQL itself (option 3), and it never fetches its own API (option 2).
- **Writes.** Every mutation is a route handler under `/api/console/`, called by a client
  component. That is not symmetry for its own sake: a write is where the session, the role gate and
  the 401/403 contract live (ADR-0021), and a route handler is a function from a `Request` to a
  `Response` that a test can call with no browser and no rendering.
- **The client.** Client components carry no database import and no business rule. They post to a
  route and render what comes back, as `IntakeForm` already does.
- **Where the query lives.** In `src/repo/`, not in the page, so the thing a test calls is the
  thing the screen shows. A page that needs a number a repository function does not return gets a
  function, not a query.

R-T4 is satisfied in full: no rows reach the browser, and no business logic lives outside the
server. What this amends is ADR-0003's stronger sentence, which was written before any page had
data and which would now buy nothing at a real cost.

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

- Console pages import from `src/repo/` and from `src/ui/`; a test asserts no `src/app/**/page.tsx`
  imports `drizzle-orm` or `@/db/schema`.
- Every console **mutation** is a route handler with an integration test that calls it directly and
  asserts 401 without a session (ADR-0021).
- The queue's counts and rows are tested against the repository function, not by rendering a page.

## More information

- ADR-0003 (the sentence this amends), ADR-0021 (where a write is refused), ADR-0023 (one
  resolution path), `REQUIREMENTS.md` R-T4, R-C1.
