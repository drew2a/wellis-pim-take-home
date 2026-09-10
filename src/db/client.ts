import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { loadEnv } from '../env';
import * as schema from './schema';

// The API is the only database client (R-T4). React components never import this module.
const sql = postgres(loadEnv().DATABASE_URL);

export const db = drizzle(sql, { schema });
