import { describe, expect, it } from 'vitest';

import { assertTestDatabaseHost } from './database';

describe('assertTestDatabaseHost', () => {
  it.each([
    'postgres://wellis:wellis@localhost:55432/wellis',
    'postgres://wellis:wellis@127.0.0.1:5432/wellis',
    'postgres://wellis:wellis@[::1]:5432/wellis',
  ])('accepts the local host %s', (url) => {
    expect(() => {
      assertTestDatabaseHost(url, false);
    }).not.toThrow();
  });

  it('refuses a remote host, naming the override', () => {
    const url = 'postgresql://user:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres';

    expect(() => {
      assertTestDatabaseHost(url, false);
    }).toThrow(
      /refusing to create test databases on "aws-0-eu-central-1.pooler.supabase.com".*ALLOW_REMOTE_TEST_DATABASE=1/,
    );
  });

  it('accepts a remote host when the override is set', () => {
    const url = 'postgresql://user:pw@db.example.com:5432/postgres';

    expect(() => {
      assertTestDatabaseHost(url, true);
    }).not.toThrow();
  });
});
