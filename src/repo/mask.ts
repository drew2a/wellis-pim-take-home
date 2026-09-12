/**
 * All but the last three characters, for an identifier that must not be readable in a jsonb
 * column. `review_items.payload` and `audit_entries.changes` are jsonb, so the console's
 * column-level masking cannot reach into them, and bsn retention is still an open vocabulary
 * item ("bsn retention: keep, mask or drop"). The full value stays in `legacy_patients_raw.bsn`
 * and `patients.bsn`, where the console reveals it under the masking that applies to a column.
 */
export function maskIdentifier(value: string): string {
  if (value.length <= 3) return '*'.repeat(value.length);
  return '*'.repeat(value.length - 3) + value.slice(-3);
}
