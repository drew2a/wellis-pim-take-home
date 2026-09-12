import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';

import type * as schema from './schema';

/**
 * A database or a transaction. Every function that reads or writes takes this, so that the CLI
 * can run a whole import inside one transaction (ADR-0009 item 6) and a test can pass its own
 * database.
 */
export type Queryable = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;
