// The session's crypto and cookie shape (ADR-0021 items 1 and 2). Pure and I/O-free: the secret
// is a parameter, so every case here runs without an environment and without a database.
import { describe, expect, it } from 'vitest';

import {
  readCookie,
  secretMatches,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  sessionSetCookie,
  signSession,
  verifySession,
} from './session';

const SECRET = 'a'.repeat(32);
const OTHER = 'b'.repeat(32);
const REVIEWER = '7f998108-fbe9-4958-b470-cace5f4e6489';
const NOW = new Date('2026-09-13T10:00:00Z');

const ago = (seconds: number): Date => new Date(NOW.getTime() - seconds * 1000);

describe('a signed session', () => {
  it('round-trips the reviewer it names', () => {
    expect(verifySession(signSession(REVIEWER, NOW, SECRET), NOW, SECRET)).toBe(REVIEWER);
  });

  it('is refused when the signature was made with another secret', () => {
    expect(verifySession(signSession(REVIEWER, NOW, OTHER), NOW, SECRET)).toBeNull();
  });

  // The whole point of signing: the id is the one field a forged cookie would change.
  it('is refused when the reviewer id is swapped', () => {
    const value = signSession(REVIEWER, NOW, SECRET);
    const forged = value.replace(REVIEWER, '00000000-0000-4000-8000-000000000000');
    expect(verifySession(forged, NOW, SECRET)).toBeNull();
  });

  it('is refused when the timestamp is moved forward to outrun the expiry', () => {
    const [id, , signature] = signSession(REVIEWER, ago(SESSION_MAX_AGE_SECONDS * 2), SECRET).split(
      '.',
    ) as [string, string, string];
    expect(verifySession(`${id}.${NOW.getTime()}.${signature}`, NOW, SECRET)).toBeNull();
  });

  it('is refused when the signature is altered', () => {
    const value = signSession(REVIEWER, NOW, SECRET);
    expect(verifySession(`${value}x`, NOW, SECRET)).toBeNull();
  });

  it.each([
    ['nothing at all', undefined],
    ['an empty string', ''],
    ['two parts', `${REVIEWER}.${NOW.getTime()}`],
    ['four parts', `${REVIEWER}.${NOW.getTime()}.sig.extra`],
  ])('is refused for %s', (_name, value) => {
    expect(verifySession(value, NOW, SECRET)).toBeNull();
  });

  // A correctly signed cookie still names something that will be put to the database.
  it('is refused when the id is not a uuid, however well signed', () => {
    expect(verifySession(signSession("'; drop table patients --", NOW, SECRET), NOW, SECRET)).toBe(
      null,
    );
  });

  it('is refused when the timestamp is not a number', () => {
    const signed = signSession(REVIEWER, NOW, SECRET);
    const [, , signature] = signed.split('.') as [string, string, string];
    expect(verifySession(`${REVIEWER}.tomorrow.${signature}`, NOW, SECRET)).toBeNull();
  });
});

describe('a session expires after a clinic day', () => {
  it('lives for twelve hours', () => {
    expect(SESSION_MAX_AGE_SECONDS).toBe(12 * 60 * 60);
  });

  it('is accepted one second before the end', () => {
    const issued = ago(SESSION_MAX_AGE_SECONDS - 1);
    expect(verifySession(signSession(REVIEWER, issued, SECRET), NOW, SECRET)).toBe(REVIEWER);
  });

  it('is refused one second after it', () => {
    const issued = ago(SESSION_MAX_AGE_SECONDS + 1);
    expect(verifySession(signSession(REVIEWER, issued, SECRET), NOW, SECRET)).toBeNull();
  });

  // A cookie that claims to have been issued after now was not issued by this server.
  it('is refused when it is dated in the future', () => {
    const issued = new Date(NOW.getTime() + 60_000);
    expect(verifySession(signSession(REVIEWER, issued, SECRET), NOW, SECRET)).toBeNull();
  });
});

describe('the console secret', () => {
  it('matches itself', () => {
    expect(secretMatches(SECRET, SECRET)).toBe(true);
  });

  it('refuses a wrong secret of the same length', () => {
    expect(secretMatches(OTHER, SECRET)).toBe(false);
  });

  // Compared as digests, so the comparison is over 32 bytes whatever was typed.
  it('refuses a wrong secret of a different length', () => {
    expect(secretMatches('short', SECRET)).toBe(false);
    expect(secretMatches(`${SECRET}extra`, SECRET)).toBe(false);
  });

  it('refuses an empty candidate', () => {
    expect(secretMatches('', SECRET)).toBe(false);
  });
});

describe('the cookie it is carried in', () => {
  it('is httpOnly, same-site and scoped to the whole console', () => {
    const header = sessionSetCookie('value', { secure: false });
    expect(header).toContain(`${SESSION_COOKIE}=value`);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`);
    expect(header).not.toContain('Secure');
  });

  it('is Secure where the deployment is', () => {
    expect(sessionSetCookie('value', { secure: true })).toContain('Secure');
  });

  it('is cleared by an empty value that expires immediately', () => {
    expect(sessionSetCookie('', { secure: false, maxAgeSeconds: 0 })).toContain('Max-Age=0');
  });

  it.each([
    ['the only cookie', `${SESSION_COOKIE}=abc`, 'abc'],
    ['among others', `theme=dark; ${SESSION_COOKIE}=abc; other=1`, 'abc'],
    ['with spaces around it', ` ${SESSION_COOKIE}=abc `, 'abc'],
    ['absent', 'theme=dark', undefined],
    ['a prefix of another name', `not_${SESSION_COOKIE}=abc`, undefined],
  ])('is read from a Cookie header holding %s', (_name, header, expected) => {
    expect(readCookie(header, SESSION_COOKIE)).toBe(expected);
  });

  it('is absent when there is no Cookie header at all', () => {
    expect(readCookie(null, SESSION_COOKIE)).toBeUndefined();
  });
});
