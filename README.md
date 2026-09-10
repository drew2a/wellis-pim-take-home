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
npm run db:migrate          # applies drizzle/ migrations (none yet)
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
npm run typecheck           # tsc --noEmit
npm run lint                # ESLint, typescript-eslint strict
npm run format:check        # Prettier (npm run format rewrites)
npm test                    # unit tests, no database
npm run test:integration    # against the compose database; skipped with a message if DATABASE_URL is unset
```

CI (`.github/workflows/ci.yml`) runs the same commands against a Postgres service container.
