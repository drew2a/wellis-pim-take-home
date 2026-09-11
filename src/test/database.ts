import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { basename } from 'node:path';
import postgres from 'postgres';
import { expect } from 'vitest';

import * as schema from '@/db/schema';
import { loadEnv } from '@/env';

export type TestDb = PostgresJsDatabase<typeof schema>;

export interface TestDatabase {
  readonly db: TestDb;
  readonly sql: postgres.Sql;
  /** Applies every migration under `drizzle/`, the same files `npm run db:migrate` applies. */
  migrate(): Promise<void>;
  /** Closes the connection pool and drops the database. */
  drop(): Promise<void>;
}

// Postgres identifiers are quoted below, but a slug this narrow also names a readable database
// in `\l` and cannot smuggle a second statement into the DDL.
const SLUG = /^[a-z][a-z0-9_]{0,40}$/;

/**
 * The database is named after the test file, not a hand-typed slug: files run in parallel, and
 * two files sharing a slug would FORCE-drop each other's live database mid-run. Vitest sets the
 * path per file, so `beforeAll` in `src/db/constraints.integration.test.ts` gets `constraints`.
 */
function slugFromTestPath(): string {
  const path = expect.getState().testPath;
  if (path === undefined) {
    throw new Error('createTestDatabase must be called from inside a Vitest test file');
  }
  const slug = basename(path)
    .replace(/\.integration\.test\.ts$/, '')
    .replaceAll(/[^a-z0-9_]/g, '_');
  if (!SLUG.test(slug)) {
    throw new Error(`test database slug must match ${SLUG.source}, got "${slug}" from ${path}`);
  }
  return slug;
}

/**
 * Isolation strategy for integration tests: a database per test file.
 *
 * ADR-0003 prescribes "a schema or a transaction" per file; this is a deliberate deviation.
 * A schema does not work because drizzle-kit pins enum DDL to `public`
 * (`CREATE TYPE "public"."sex"`), so a schema swap would need the migration SQL rewritten,
 * while a fresh database runs the committed files verbatim, as production does. A rolled-back
 * transaction per test does not work because constraint tests abort the transaction on every
 * expected failure, and because the migration and trigger behaviour under test is DDL.
 *
 * Needs CREATEDB on the DATABASE_URL role (README, Checks); the compose and CI users are
 * superusers.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `wellis_test_${slugFromTestPath()}`;
  const env = loadEnv();
  const maintenanceUrl = env.DATABASE_URL;
  assertTestDatabaseHost(maintenanceUrl, env.ALLOW_REMOTE_TEST_DATABASE === '1');

  await withMaintenanceConnection(maintenanceUrl, async (admin) => {
    // A previous run that crashed before `drop()` leaves its database behind; FORCE also
    // evicts a connection that run left open.
    await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE "${name}"`);
  });

  const url = new URL(maintenanceUrl);
  url.pathname = `/${name}`;
  const sql = postgres(url.href, { max: 3 });
  const db = drizzle(sql, { schema });

  return {
    db,
    sql,
    migrate: () => migrate(db, { migrationsFolder: 'drizzle' }),
    drop: async () => {
      await sql.end();
      await withMaintenanceConnection(maintenanceUrl, (admin) =>
        admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`),
      );
    },
  };
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * `DROP DATABASE ... WITH (FORCE)` on a host that is not this machine is a production incident
 * waiting for a .env left pointing at Supabase. Exported for its unit test.
 */
export function assertTestDatabaseHost(url: string, allowRemote: boolean): void {
  const { hostname } = new URL(url);
  if (allowRemote || LOCAL_HOSTS.has(hostname)) {
    return;
  }
  throw new Error(
    `refusing to create test databases on "${hostname}": DATABASE_URL must point at a local ` +
      'Postgres, or set ALLOW_REMOTE_TEST_DATABASE=1 to override',
  );
}

async function withMaintenanceConnection(
  url: string,
  run: (admin: postgres.Sql) => Promise<unknown>,
): Promise<void> {
  const admin = postgres(url, { max: 1 });
  try {
    await run(admin);
  } finally {
    await admin.end();
  }
}

/**
 * Asserts that a database operation is rejected with a Postgres error matching `pattern`.
 * Drizzle wraps driver errors in a "Failed query" error and keeps the Postgres message in
 * `cause`; raw postgres-js calls throw the Postgres error itself. Both are handled here.
 */
export async function expectDatabaseError(
  operation: Promise<unknown>,
  pattern: RegExp,
): Promise<void> {
  const error: unknown = await operation.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof Error)) {
    throw new Error(`expected a database error matching ${pattern.source}, but nothing was thrown`);
  }
  const postgresError = error.cause instanceof Error ? error.cause : error;
  if (!pattern.test(postgresError.message)) {
    throw new Error(
      `expected a database error matching ${pattern.source}, got: ${postgresError.message}`,
    );
  }
}
