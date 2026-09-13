// `GET /api/console/patients/search?q=` — the one search the console has, for attaching an orphan
// intake to a record (ADR-0006). A route because a client component asks it; the browser reaches
// data only through routes (ADR-0024).
//
// It returns patients to choose from and nothing derived: no score, no ranking a reviewer would
// have to trust, no business rule. The attaching itself is a decision the server takes from the
// item, on `POST /api/console/items/:id/resolve`.
import { z } from 'zod';

import { currentReviewer } from '@/console/reviewer';
import { getDb } from '@/db/client';
import { searchPatients } from '@/repo/patients';

import { badRequest, issuesOf, json, serverError, unauthorized } from '../../../http';

const querySchema = z.string().trim().min(2, 'type at least two characters').max(200);

export async function GET(request: Request): Promise<Response> {
  const reviewer = await currentReviewer(request);
  if (reviewer === null) return unauthorized();

  const query = querySchema.safeParse(new URL(request.url).searchParams.get('q') ?? '');
  if (!query.success) return badRequest('that is not a search', issuesOf(query.error));

  try {
    return json({ patients: await searchPatients(getDb(), query.data) });
  } catch (error) {
    return serverError('searching for a patient failed', error);
  }
}
