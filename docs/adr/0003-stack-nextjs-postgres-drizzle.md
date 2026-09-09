# ADR-0003: Stack — Next.js, Postgres (Supabase-hosted), Drizzle, Vitest

- **Status:** proposed
- **Date:** 2026-09-08
- **Deciders:** Andrei Andreev (pending)
- **Requirements:** R-T1, R-T2, R-T3, R-T4, R-T5, R-T6, R-T7, R-S2

## Context and problem statement

The brief fixes React + TypeScript on the front end, a Node/TypeScript API of our own
design, a real database (Postgres or SQLite) and a public deployment seeded with the
imported data (§4). Within those constraints the stack must let one engineer, amplified
by an agent, ship three surfaces (importer, intake flow, review console) in seven days,
while keeping the properties the assignment grades hardest: constraints that make illegal
states impossible, idempotent writes, and tests that prove the import logic against a
real database.

## Decision drivers

- One deployable, one language, one type system across UI, API and importer — fewer seams
  for the agent to get wrong across sessions.
- Database-level guarantees (unique keys, check constraints, foreign keys, transactions)
  for idempotency (R-A15) and impossible transitions (R-B15, R-B16).
- Tests against the real database engine (R-T7); no behavioural gap between test and prod.
- Deployment that seeds from the importer with no manual steps (R-T6).
- Schema and SQL stay readable in the follow-up: reviewers will read migrations.

## Considered options

1. Next.js (App Router, Route Handlers) + Postgres + Drizzle + Vitest, deployed on Vercel
   with Supabase-hosted Postgres.
2. Separate Vite/React SPA + Fastify API + Postgres + Prisma, deployed on Fly.io.
3. Next.js + SQLite (better-sqlite3 / libSQL), deployed on Fly.io with a volume.

## Decision outcome

Chosen option: **Option 1**, because it is one deployable in one language with the API as
first-class server code (satisfying R-T4 without a second service), Postgres gives the
constraint and transaction model the graded properties depend on, Drizzle keeps the schema
as readable SQL-shaped TypeScript with plain SQL migrations, and Supabase-hosted Postgres
is explicitly allowed by the brief while we use nothing of Supabase except the connection
string.

Concretely:

- Node 22, TypeScript `strict`, npm.
- Next.js App Router: React Server Components for read views, client components only
  where interaction needs them; API as Route Handlers under `app/api/**`. No React
  component imports the data layer.
- PostgreSQL 17 locally via `docker compose`; Supabase Postgres in production through the
  pooled connection string. PostgREST and the Supabase JS client are not used.
- Drizzle ORM + drizzle-kit SQL migrations in `drizzle/`. Constraints are declared in the
  schema so they exist in the database, not only in code.
- Zod schemas at boundaries: API input, CSV/JSONL row parsing, environment.
- Vitest: pure unit tests for eligibility, state machine and normalisers; integration
  tests for importer, repositories and API against the compose Postgres, each test file
  in its own schema or transaction for isolation.
- ESLint (typescript-eslint strict) + Prettier + `tsc --noEmit` + tests in GitHub Actions
  with a Postgres service container.
- Importer as a CLI (`npm run import`, tsx) that also produces the import report; the
  production seed is the same command pointed at the production database.
- Vercel for hosting.

### Consequences

- Good: a single repo, single deploy, single test runner; agent sessions cannot drift
  between front-end and back-end conventions.
- Good: idempotency and illegal-transition prevention can be enforced by the database and
  proven by tests running on the same engine as production.
- Bad: Next.js Route Handlers are less ergonomic than a dedicated API framework for
  middleware and OpenAPI; accepted, the API surface is small and internal.
- Bad: Vercel functions are stateless and time-limited; the importer therefore runs as a
  CLI against the database, not as an HTTP endpoint. Accepted and arguably safer.
- Neutral: Supabase is used as plain Postgres; if it were swapped for Neon or RDS nothing
  above changes except the connection string.

### Confirmation

- `docker compose up` + `npm run db:migrate` + `npm test` passes on a clean machine.
- `grep -r "@supabase" package.json` returns nothing.
- Production URL serves `/review` with data produced by `npm run import` against the
  production database; the import report in `reports/` matches the live counts.

## Pros and cons of the options

### 2. Vite SPA + Fastify + Prisma on Fly.io

- Good: cleaner API layer, OpenAPI for free, Fly keeps a long-running process for imports.
- Bad: two deployables and two build pipelines for a seven-day solo build; Prisma hides
  SQL behind its own schema language, which makes migrations harder to read in review.

### 3. Next.js + SQLite

- Good: zero database hosting, trivial local setup.
- Bad: weaker concurrent-write story on a hosted volume, no schema-level partial indexes
  and check-constraint ergonomics we rely on, and a test/prod gap once the database is
  hosted differently; the brief allows it but the graded properties favour Postgres.

## More information

- ASSIGNMENT.md §4 Constraints.
- Recorded in `CLAUDE.md` §8.
