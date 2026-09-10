import { describe, expect, it } from 'vitest';

import { parseEnv } from './env';

describe('parseEnv', () => {
  it('rejects a missing DATABASE_URL', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a DATABASE_URL that is not a URL', () => {
    expect(() => parseEnv({ DATABASE_URL: 'not-a-url' })).toThrow(/DATABASE_URL/);
  });

  it('rejects a DATABASE_URL that is not a postgres URL', () => {
    expect(() => parseEnv({ DATABASE_URL: 'https://example.com/db' })).toThrow(/DATABASE_URL/);
  });

  it('returns a valid postgres URL unchanged', () => {
    const url = 'postgres://wellis:wellis@localhost:5432/wellis';
    expect(parseEnv({ DATABASE_URL: url })).toEqual({ DATABASE_URL: url });
  });

  it('accepts the postgresql scheme', () => {
    const url = 'postgresql://wellis:wellis@localhost:5432/wellis';
    expect(parseEnv({ DATABASE_URL: url }).DATABASE_URL).toBe(url);
  });
});
