import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

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
 * Isolation strategy for integration tests (ADR-0003): a database per test file.
 *
 * A whole database rather than a schema because drizzle-kit pins enum DDL to `public`
 * (`CREATE TYPE "public"."sex"`), so a schema swap would need the migration SQL rewritten. A
 * fresh database runs the committed files verbatim, as production does. A rolled-back
 * transaction per test was rejected because constraint tests abort the transaction on every
 * expected failure, and because the migration and trigger behaviour under test is DDL.
 *
 * Needs CREATEDB on the DATABASE_URL role; the compose and CI users are superusers.
 */
export async function createTestDatabase(slug: string): Promise<TestDatabase> {
  if (!SLUG.test(slug)) {
    throw new Error(`test database slug must match ${SLUG.source}, got "${slug}"`);
  }
  const name = `wellis_test_${slug}`;
  const maintenanceUrl = loadEnv().DATABASE_URL;

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
