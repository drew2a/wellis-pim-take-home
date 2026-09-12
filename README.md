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
npm run import -- --as-of 2026-09-08            # loads legacy_export/ into DATABASE_URL
npm run import -- --as-of 2026-09-08 --dry-run  # same run, rolled back; only its import_runs row stays
```

One run reads the three files, stores every row byte-faithfully in the `legacy_*_raw` tables,
maps them into the canonical tables by the rules of ADR-0005, writes a normalisation record for
every value that differs from raw, and raises review items for what the mapping cannot decide.
Everything after the `import_runs` row happens in one transaction: a run that fails writes
nothing else. `--as-of` is the reference date for every "future" judgement (a birth date after
it is impossible) and is stored on the run so it is reproducible; it is required, never the
clock. The command prints the counts per rule code, per field, and per review-item type and
scope. Those printed numbers are the only source for any figure quoted about the import; none is
typed by hand. Running the command twice changes no table but `import_runs`
(`src/import/run.integration.test.ts`). The rule set the importer applies lives in
`rules/v1.json`; the codes and their evidence in `src/import/mapper/rule-codes.ts`; the
conventions in ADR-0009. Detector items (plausibility, weight divergence, consent state,
duplicate patients) and the report files are not part of this command yet.

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
