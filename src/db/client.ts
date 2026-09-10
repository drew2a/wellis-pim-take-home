import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { loadEnv } from '../env';
import * as schema from './schema';

export type Db = ReturnType<typeof createDb>;

function createDb() {
  const sql = postgres(loadEnv().DATABASE_URL, {
    // Production is Supabase through the pooled connection string (ADR-0003). The pooler runs
    // in transaction mode, which does not support prepared statements; `prepare: true` would
    // fail intermittently with "prepared statement does not exist" once the pooler hands
    // successive queries to different backend connections.
    prepare: false,
    // Vercel keeps many function instances warm at once and the pooler caps clients, so each
    // instance holds few connections and releases idle ones instead of the default 10 kept
    // open forever.
    max: 5,
    idle_timeout: 20,
    // The health probe must answer 503 within a Vercel function's budget when the database host
    // drops packets; the default of 30 s is longer than that budget and than any uptime monitor.
    connect_timeout: 5,
    // TLS is a property of the database, not of the process: production URLs carry
    // `?sslmode=require`, which postgres-js reads from the connection string; the compose URL
    // carries nothing because that database has no certificate.
  });
  return drizzle(sql, { schema });
}

// `next dev` re-evaluates this module on every edit. A module-scope cache is lost with the old
// module, and each evaluation would open a new pool while the previous pool's connections stay
// open until the server stops. `globalThis` survives the re-evaluation.
const cache = globalThis as { __wellisDb?: Db };

/**
 * The API is the only database client (R-T4). React components never import this module.
 *
 * The client is created on first use, not at import: `next build` evaluates route modules
 * while collecting page data, and a module-scope client would make the build depend on a
 * valid DATABASE_URL.
 */
export function getDb(): Db {
  cache.__wellisDb ??= createDb();
  return cache.__wellisDb;
}
