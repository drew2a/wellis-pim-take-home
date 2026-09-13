// `POST /api/console/session` signs a reviewer in; `DELETE` signs them out (ADR-0021).
//
// This is the only route that reads a reviewer id from a request body, and it is the reason the
// others never have to: what it returns is a signed cookie, and from then on `currentReviewer()`
// answers who the caller is. The body carries a reviewer and a secret and **nothing else** — the
// schema is strict, so a caller that tries to declare a role is refused rather than ignored.
import { z } from 'zod';

import { secretMatches, sessionSetCookie, signSession } from '@/console/session';
import { getDb } from '@/db/client';
import { loadEnv } from '@/env';
import { findReviewer } from '@/reviewers/repo';

import { badRequest, issuesOf, json, serverError, unauthorized } from '../../http';

// `.strict()`: an unknown key is a caller trying to say something this route does not let them say.
const signInSchema = z.object({ reviewerId: z.uuid(), secret: z.string() }).strict();

/** Set on a response rather than through `next/headers`, so the handler stays a plain function. */
const withCookie = (response: Response, cookie: string): Response => {
  response.headers.set('Set-Cookie', cookie);
  return response;
};

const secure = (): boolean => process.env.NODE_ENV === 'production';

export async function POST(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return badRequest('the request body is not JSON');
  }
  const parsed = signInSchema.safeParse(raw);
  if (!parsed.success) return badRequest('that is not a sign-in', issuesOf(parsed.error));

  try {
    // The secret first and in constant time, so the answer does not depend on whether the reviewer
    // exists — and one answer for both failures, so the login page cannot be used to list the team.
    if (!secretMatches(parsed.data.secret, loadEnv().CONSOLE_SECRET)) return unauthorized();

    const reviewer = await findReviewer(getDb(), parsed.data.reviewerId);
    if (reviewer === null) return unauthorized();

    const session = signSession(reviewer.id, new Date(), loadEnv().CONSOLE_SECRET);
    return withCookie(json(reviewer), sessionSetCookie(session, { secure: secure() }));
  } catch (error) {
    return serverError('signing in to the console failed', error);
  }
}

/**
 * Signing out is a cookie that expires now. There is no session store to delete from — the session
 * is the signature — so this is the whole of it, and the only other revocation is rotating
 * `CONSOLE_SECRET`, which signs everyone out at once (ADR-0021 item 2).
 */
export function DELETE(): Response {
  return withCookie(
    json({ signedOut: true }),
    sessionSetCookie('', { secure: secure(), maxAgeSeconds: 0 }),
  );
}
