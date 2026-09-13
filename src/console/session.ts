// The console session (ADR-0021). Everything here is pure: the secret is a parameter, never read
// from the environment, so the crypto is testable without one and there is no way for a caller to
// accidentally verify against a different secret than the one that signed.
//
// The cookie carries `<reviewer id>.<issued at>.<hmac>` and **never a role**. What a reviewer may
// do is loaded from the `reviewers` row on every request (`./reviewer.ts`), so a role change takes
// effect immediately and a forged role is not expressible even if the signature were broken.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'wellis_console';

/** A clinic day. After it, the reviewer logs in again; there is no refresh and no sliding window. */
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

/** `<reviewer id>.<issued at>.<hmac>`; an id holding a `.` would split into more. */
const PART_COUNT = 3;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const digest = (payload: string, secret: string): string =>
  createHmac('sha256', secret).update(payload).digest('base64url');

/**
 * Constant-time over two strings of the same length. Length itself is not secret here: the
 * signature is always 43 base64url characters, and the console secret is compared as a digest
 * below rather than directly, so neither comparison leaks how long the secret is.
 */
function equals(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signSession(reviewerId: string, issuedAt: Date, secret: string): string {
  const payload = `${reviewerId}.${issuedAt.getTime()}`;
  return `${payload}.${digest(payload, secret)}`;
}

/**
 * The reviewer id a cookie names, or null. Null covers every failure with one answer — no
 * signature, a wrong one, an id that is not a uuid, an unreadable or future or expired timestamp —
 * because the caller's response to all of them is the same and a more specific error would only
 * tell whoever sent the cookie which part to fix next.
 */
export function verifySession(value: string | undefined, now: Date, secret: string): string | null {
  if (value === undefined || value === '') return null;
  const parts = value.split('.');
  if (parts.length !== PART_COUNT) return null;
  const [reviewerId, issuedAt, signature] = parts as [string, string, string];
  if (!UUID.test(reviewerId)) return null;
  if (!equals(digest(`${reviewerId}.${issuedAt}`, secret), signature)) return null;

  const at = Number(issuedAt);
  if (!Number.isSafeInteger(at)) return null;
  const age = now.getTime() - at;
  if (age < 0 || age > SESSION_MAX_AGE_SECONDS * 1000) return null;
  return reviewerId;
}

/**
 * Whether the secret typed at the login page is the console's. Both sides are hashed first, so the
 * comparison is always over 32 bytes and a candidate of the wrong length is refused by its digest
 * rather than by its length (ADR-0021 item 1).
 */
export function secretMatches(candidate: string, secret: string): boolean {
  const sha = (value: string): Buffer => createHash('sha256').update(value).digest();
  return timingSafeEqual(sha(candidate), sha(secret));
}

/**
 * The `Set-Cookie` header, built here rather than through `next/headers` so that a route handler
 * is a function from a `Request` to a `Response` and can be called directly from a test.
 */
export function sessionSetCookie(
  value: string,
  options: { readonly secure: boolean; readonly maxAgeSeconds?: number },
): string {
  const attributes = [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${options.maxAgeSeconds ?? SESSION_MAX_AGE_SECONDS}`,
  ];
  if (options.secure) attributes.push('Secure');
  return attributes.join('; ');
}

/** One named cookie out of a `Cookie` header. Names match whole, so `not_x` is not `x`. */
export function readCookie(header: string | null, name: string): string | undefined {
  if (header === null) return undefined;
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() === name) return pair.slice(separator + 1).trim();
  }
  return undefined;
}
