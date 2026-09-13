// Who is doing this (ADR-0021 item 3). One helper, used by every console page and every mutating
// console route, and the only answer to the question. The actor of every write in the console —
// a transition, a merge, an item resolution, a bsn reveal — is what this returns.
//
// No route schema declares an actor, a reviewer or a role, so there is no path from a request body
// to `audit_entries.actor`. An audit entry is evidence, and a name the caller chose is not.
import { getDb } from '@/db/client';
import type { ReviewerRole } from '@/db/schema';
import { loadEnv } from '@/env';
import { findReviewer } from '@/reviewers/repo';

import { readCookie, SESSION_COOKIE, verifySession } from './session';

export interface ConsoleReviewer {
  readonly id: string;
  /** As it is now. The audit entry copies it, so a later rename does not rewrite the evidence. */
  readonly name: string;
  readonly role: ReviewerRole;
}

/**
 * The cookie header, from the `Request` a route handler was given, or — for a page, which has no
 * request — from Next's own store. The dynamic import keeps `next/headers` out of every module
 * that only ever passes a request, so a route handler stays a plain function a test can call.
 */
async function cookieHeader(request: Request | undefined): Promise<string | null> {
  if (request !== undefined) return request.headers.get('cookie');
  const { headers } = await import('next/headers');
  return (await headers()).get('cookie');
}

/**
 * The reviewer this request is from, or null. Null is the whole of "not signed in": no cookie, a
 * forged or expired one, or one naming somebody who is no longer on the team. The caller turns
 * that into a 401 (a route) or a redirect to `/login` (a page); nothing else may act on it.
 */
export async function currentReviewer(request?: Request): Promise<ConsoleReviewer | null> {
  const cookie = readCookie(await cookieHeader(request), SESSION_COOKIE);
  const reviewerId = verifySession(cookie, new Date(), loadEnv().CONSOLE_SECRET);
  if (reviewerId === null) return null;

  // The row is the identity, and it carries the role: the cookie never does (ADR-0021 item 2).
  return findReviewer(getDb(), reviewerId);
}
