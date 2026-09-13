/**
 * All but the last three characters, for an identifier that must not be readable in a jsonb
 * column. `review_items.payload` and `audit_entries.changes` are jsonb, so the console's
 * column-level masking cannot reach into them, and bsn retention is still an open vocabulary
 * item ("bsn retention: keep, mask or drop"). The full value stays in `legacy_patients_raw.bsn`
 * and `patients.bsn` — every stored row keeps what was exported — and the only way to a readable
 * number is the reveal route, which writes an audit entry before it answers (ADR-0023 item 8).
 */
export function maskIdentifier(value: string): string {
  if (value.length <= 3) return '*'.repeat(value.length);
  return '*'.repeat(value.length - 3) + value.slice(-3);
}
