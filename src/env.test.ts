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

  it('accepts a URL that carries sslmode=require, how production URLs request TLS', () => {
    const url = 'postgresql://user:pw@db.example.supabase.co:6543/postgres?sslmode=require';
    expect(parseEnv({ DATABASE_URL: url }).DATABASE_URL).toBe(url);
  });

  it('leaves MIGRATION_URL absent when it is not set', () => {
    const url = 'postgres://wellis:wellis@localhost:5432/wellis';
    expect(parseEnv({ DATABASE_URL: url })).not.toHaveProperty('MIGRATION_URL');
  });

  it('accepts a MIGRATION_URL, the session-pooler string migrations use in production', () => {
    const url = 'postgres://wellis:wellis@localhost:6543/wellis';
    const migration = 'postgresql://user:pw@db.example.supabase.co:5432/postgres?sslmode=require';
    expect(parseEnv({ DATABASE_URL: url, MIGRATION_URL: migration }).MIGRATION_URL).toBe(migration);
  });

  it('rejects a MIGRATION_URL that is not a postgres URL', () => {
    const url = 'postgres://wellis:wellis@localhost:5432/wellis';
    expect(() => parseEnv({ DATABASE_URL: url, MIGRATION_URL: 'https://example.com' })).toThrow(
      /MIGRATION_URL/,
    );
  });
});
