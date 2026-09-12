// Byte-faithful CSV reading (R-A8). Every field is kept exactly as exported, untrimmed; every
// record keeps its physical line number and the bytes it occupied in the file, which is what
// `row_hash` is computed over and what the round-trip test compares with the source line.
import { parse } from 'csv-parse/sync';

export interface CsvRecord {
  /** 1-based physical line the record starts on; the header is line 1. */
  readonly lineNo: number;
  /** The record's bytes as exported, without the line terminator. */
  readonly raw: Uint8Array;
  readonly fields: readonly string[];
}

interface ParsedRecord {
  record: string[];
  info: { bytes: number; lines: number };
}

const TERMINATOR = /\r?\n$/u;

/**
 * Parses a whole CSV file. The header must equal `expectedHeader` exactly and every record must
 * have as many fields as the header: a different export layout is a run-stopping fact about the
 * file, not a row to skip (CLAUDE.md §2, "fail loudly").
 */
export function parseCsv(bytes: Uint8Array, expectedHeader: readonly string[]): CsvRecord[] {
  const parsed = parse(Buffer.from(bytes), {
    bom: false,
    trim: false,
    info: true,
    relax_column_count: true,
    skip_empty_lines: false,
  }) as unknown as ParsedRecord[];

  const [header, ...rows] = parsed;
  if (header === undefined || !sameFields(header.record, expectedHeader)) {
    throw new Error(
      `CSV header mismatch: expected ${JSON.stringify(expectedHeader)}, got ${JSON.stringify(header?.record ?? [])}`,
    );
  }

  const text = Buffer.from(bytes);
  let offset = header.info.bytes;
  let lineNo = header.info.lines + 1;
  return rows.map((row) => {
    const record = row.record;
    if (record.length !== expectedHeader.length) {
      throw new Error(
        `CSV line ${lineNo}: expected ${expectedHeader.length} fields, got ${record.length}`,
      );
    }
    const slice = text.subarray(offset, row.info.bytes).toString('latin1');
    const raw = text.subarray(offset, offset + slice.replace(TERMINATOR, '').length);
    const result: CsvRecord = { lineNo, raw, fields: record };
    offset = row.info.bytes;
    lineNo = row.info.lines + 1;
    return result;
  });
}

function sameFields(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((field, i) => field === b[i]);
}

const NEEDS_QUOTES = /[",\r\n]/u;

/**
 * RFC 4180 with minimal quoting: a field is quoted only when it contains a comma, a quote or a
 * line break. The export uses exactly this form (data-profile P-15, P-28: 428 quoted fields, all
 * containing a comma), so the round-trip test can compare bytes, not parses.
 */
export function serialiseCsvRecord(fields: readonly string[]): string {
  return fields
    .map((field) => (NEEDS_QUOTES.test(field) ? `"${field.replaceAll('"', '""')}"` : field))
    .join(',');
}
