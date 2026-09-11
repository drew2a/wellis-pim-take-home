import { describe, expect, it } from 'vitest';

import { parseArgs } from './cli';

describe('parseArgs', () => {
  it('requires --as-of as a calendar date and defaults to a real run', () => {
    expect(parseArgs(['--as-of', '2026-09-08'])).toEqual({ asOf: '2026-09-08', dryRun: false });
    expect(parseArgs(['--as-of=2026-09-08', '--dry-run'])).toEqual({
      asOf: '2026-09-08',
      dryRun: true,
    });
  });

  it('rejects a missing, malformed or non-calendar date and unknown arguments', () => {
    expect(() => parseArgs([])).toThrow(/usage/);
    expect(() => parseArgs(['--as-of', '8-9-2026'])).toThrow(/YYYY-MM-DD/);
    expect(() => parseArgs(['--as-of', '2026-02-30'])).toThrow(/calendar/);
    expect(() => parseArgs(['--as-of', '2026-09-08', '--force'])).toThrow(/unknown argument/);
  });
});
