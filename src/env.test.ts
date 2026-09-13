import { describe, expect, it } from 'vitest';

import { parseEnv } from './env';

// Both required variables, so a case that is not about one of them still parses (ADR-0021 item 1).
const DATABASE_URL = 'postgres://wellis:wellis@localhost:5432/wellis';
const CONSOLE_SECRET = 'x'.repeat(32);
const required = { DATABASE_URL, CONSOLE_SECRET };

describe('parseEnv', () => {
  it('rejects a missing DATABASE_URL', () => {
    expect(() => parseEnv({ CONSOLE_SECRET })).toThrow(/DATABASE_URL/);
  });

  it('rejects a DATABASE_URL that is not a URL', () => {
    expect(() => parseEnv({ ...required, DATABASE_URL: 'not-a-url' })).toThrow(/DATABASE_URL/);
  });

  it('rejects a DATABASE_URL that is not a postgres URL', () => {
    expect(() => parseEnv({ ...required, DATABASE_URL: 'https://example.com/db' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('returns a valid postgres URL unchanged', () => {
    expect(parseEnv(required)).toEqual(required);
  });

  it('accepts the postgresql scheme', () => {
    const url = 'postgresql://wellis:wellis@localhost:5432/wellis';
    expect(parseEnv({ ...required, DATABASE_URL: url }).DATABASE_URL).toBe(url);
  });

  it('accepts a URL that carries sslmode=require, how production URLs request TLS', () => {
    const url = 'postgresql://user:pw@db.example.supabase.co:6543/postgres?sslmode=require';
    expect(parseEnv({ ...required, DATABASE_URL: url }).DATABASE_URL).toBe(url);
  });

  it('leaves MIGRATION_URL absent when it is not set', () => {
    expect(parseEnv(required)).not.toHaveProperty('MIGRATION_URL');
  });

  it('accepts a MIGRATION_URL, the session-pooler string migrations use in production', () => {
    const migration = 'postgresql://user:pw@db.example.supabase.co:5432/postgres?sslmode=require';
    expect(parseEnv({ ...required, MIGRATION_URL: migration }).MIGRATION_URL).toBe(migration);
  });

  it('treats an empty MIGRATION_URL as unset, as `MIGRATION_URL=` in .env or an unbound CI secret', () => {
    expect(parseEnv({ ...required, MIGRATION_URL: '' }).MIGRATION_URL).toBeUndefined();
  });

  it('rejects a MIGRATION_URL that is not a postgres URL', () => {
    expect(() => parseEnv({ ...required, MIGRATION_URL: 'https://example.com' })).toThrow(
      /MIGRATION_URL/,
    );
  });
});

// Required, not optional: an optional secret whose absence means "no session needed" is exactly
// the silent fallback CLAUDE.md §2 forbids, and the thing it would fall back to is an unlocked
// console over patient records (ADR-0021 item 1).
describe('CONSOLE_SECRET', () => {
  it('is refused when it is missing', () => {
    expect(() => parseEnv({ DATABASE_URL })).toThrow(/CONSOLE_SECRET/);
  });

  it('is refused when it is empty', () => {
    expect(() => parseEnv({ DATABASE_URL, CONSOLE_SECRET: '' })).toThrow(/CONSOLE_SECRET/);
  });

  it('is refused when it is short enough to guess', () => {
    expect(() => parseEnv({ DATABASE_URL, CONSOLE_SECRET: 'hunter2' })).toThrow(/CONSOLE_SECRET/);
  });

  it('is taken verbatim, spaces and all, because it is a secret and not a name', () => {
    const secret = `  ${'y'.repeat(40)}  `;
    expect(parseEnv({ DATABASE_URL, CONSOLE_SECRET: secret }).CONSOLE_SECRET).toBe(secret);
  });
});

// A reviewer named after a named process would be audited like a machine (ADR-0008 item 1) and
// have their field edits overwritten by the importer (ADR-0004, R-A17), so the name is refused at
// the boundary rather than discovered later in the audit log.
describe('REVIEWERS names that collide with a named process', () => {
  it.each(['importer', 'legacy import', 'intake form', 'eligibility engine'])(
    'refuses a reviewer called %s',
    (name) => {
      expect(() => parseEnv({ ...required, REVIEWERS: JSON.stringify([{ name }]) })).toThrow(
        /named process/,
      );
    },
  );

  it('refuses one that is only padded with whitespace, because the name is trimmed first', () => {
    expect(() =>
      parseEnv({
        ...required,
        REVIEWERS: JSON.stringify([{ name: '  importer  ' }]),
      }),
    ).toThrow(/named process/);
  });

  // A deployed REVIEWERS still carries the role ADR-0027 removed. `loadEnv()` runs at boot for the
  // whole app, so the key is dropped rather than refused: a strict schema would take the app down
  // on the first deploy after the change instead of seeding a reviewer who no longer has a role.
  it('drops a role a deployed value still carries, rather than refusing to boot', () => {
    const env = parseEnv({
      ...required,
      REVIEWERS: JSON.stringify([{ name: 'Dr Vermeer', role: 'doctor' }]),
    });
    expect(env.REVIEWERS).toEqual([{ name: 'Dr Vermeer' }]);
  });

  it('still accepts a person whose name merely contains one', () => {
    const env = parseEnv({
      ...required,
      REVIEWERS: JSON.stringify([{ name: 'Dr Importer-Jansen' }]),
    });
    expect(env.REVIEWERS).toEqual([{ name: 'Dr Importer-Jansen' }]);
  });
});
