import { sql } from 'drizzle-orm';

import { getDb } from '@/db/client';

export async function GET(): Promise<Response> {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ status: 'ok' });
  } catch (error) {
    // The reason stays in the server log; the response never carries connection details.
    console.error('health check failed', error);
    return Response.json({ status: 'unavailable' }, { status: 503 });
  }
}
