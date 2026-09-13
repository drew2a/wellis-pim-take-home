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

  it('treats an empty MIGRATION_URL as unset, as `MIGRATION_URL=` in .env or an unbound CI secret', () => {
    const url = 'postgres://wellis:wellis@localhost:5432/wellis';
    expect(parseEnv({ DATABASE_URL: url, MIGRATION_URL: '' }).MIGRATION_URL).toBeUndefined();
  });

  it('rejects a MIGRATION_URL that is not a postgres URL', () => {
    const url = 'postgres://wellis:wellis@localhost:5432/wellis';
    expect(() => parseEnv({ DATABASE_URL: url, MIGRATION_URL: 'https://example.com' })).toThrow(
      /MIGRATION_URL/,
    );
  });
});

// A reviewer named after a named process would be audited like a machine (ADR-0008 item 1) and
// have their field edits overwritten by the importer (ADR-0004, R-A17), so the name is refused at
// the boundary rather than discovered later in the audit log.
describe('REVIEWERS names that collide with a named process', () => {
  const DATABASE_URL = 'postgres://wellis:wellis@localhost:5432/wellis';

  it.each(['importer', 'legacy import', 'intake form', 'eligibility engine'])(
    'refuses a reviewer called %s',
    (name) => {
      expect(() =>
        parseEnv({ DATABASE_URL, REVIEWERS: JSON.stringify([{ name, role: 'doctor' }]) }),
      ).toThrow(/named process/);
    },
  );

  it('refuses one that is only padded with whitespace, because the name is trimmed first', () => {
    expect(() =>
      parseEnv({
        DATABASE_URL,
        REVIEWERS: JSON.stringify([{ name: '  importer  ', role: 'ops' }]),
      }),
    ).toThrow(/named process/);
  });

  it('still accepts a person whose name merely contains one', () => {
    const env = parseEnv({
      DATABASE_URL,
      REVIEWERS: JSON.stringify([{ name: 'Dr Importer-Jansen', role: 'doctor' }]),
    });
    expect(env.REVIEWERS).toEqual([{ name: 'Dr Importer-Jansen', role: 'doctor' }]);
  });
});
