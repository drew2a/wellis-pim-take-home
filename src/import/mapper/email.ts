// Email (ADR-0005, findings): trimmed and lowercased, each step its own record. A value that
// fails the syntax check is null: a placeholder gets no proposal, an address with internal
// whitespace gets the address without it as a proposal (applied only by a human, ADR-0005 layer 3).
import { trimWhitespace } from './text';
import { mapped, type Mapped, type RecordDraft } from './types';

// The check the profile used (data-profile P-3): something@something.tld, no whitespace.
const SYNTAX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u;

export function mapEmail(raw: string): Mapped<string | null> {
  const trimmed = trimWhitespace(raw, 'email');
  const records: RecordDraft[] = [...trimmed.records];
  let value = trimmed.value;
  if (value === '') {
    return mapped(null, records);
  }
  const lower = value.toLowerCase();
  if (lower !== value) {
    records.push({ field: 'email', from: value, to: lower, ruleCode: 'EMAIL_LOWERCASE' });
    value = lower;
  }
  if (SYNTAX.test(value)) {
    return mapped(value, records);
  }
  const withoutSpaces = value.replaceAll(/\s+/gu, '');
  if (withoutSpaces !== value && SYNTAX.test(withoutSpaces)) {
    records.push({
      field: 'email',
      from: value,
      to: null,
      ruleCode: 'EMAIL_INTERNAL_SPACE_TO_NULL',
    });
    return mapped(null, records, [
      { kind: 'email_internal_space', field: 'email', raw, proposed: withoutSpaces },
    ]);
  }
  records.push({ field: 'email', from: value, to: null, ruleCode: 'EMAIL_PLACEHOLDER_TO_NULL' });
  return mapped(null, records, [{ kind: 'email_placeholder', field: 'email', raw }]);
}
