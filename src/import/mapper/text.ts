import { mapped, unchanged, type Mapped } from './types';

/** Trims edge whitespace with a `WHITESPACE_TRIM` record when anything was removed (R-A7). */
export function trimWhitespace(raw: string, field: string): Mapped<string> {
  const trimmed = raw.trim();
  if (trimmed === raw) {
    return unchanged(raw);
  }
  return mapped(trimmed, [{ field, from: raw, to: trimmed, ruleCode: 'WHITESPACE_TRIM' }]);
}
