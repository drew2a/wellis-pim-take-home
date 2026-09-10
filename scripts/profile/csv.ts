/**
 * CSV loading that keeps every field exactly as exported.
 *
 * `relax_column_count` is on so a row with the wrong number of fields is counted rather
 * than fatal, and trimming is off so leading and trailing whitespace survives into the
 * inventories.
 */
import { parse } from 'csv-parse/sync';
import { Counter, readFileInfo, type FileInfo } from './util.js';

export interface Csv {
  readonly info: FileInfo;
  readonly header: readonly string[];
  /** Data rows only, in file order. */
  readonly rows: readonly (readonly string[])[];
  readonly delimiter: string;
  readonly fieldCounts: Counter;
  readonly relaxedQuotes: boolean;
  /** Rows whose field count differs from the header's. */
  readonly raggedRows: readonly number[];
  /** Fields containing a line break, i.e. records spanning several physical lines. */
  readonly fieldsWithNewline: number;
}

function detectDelimiter(headerLine: string): string {
  const candidates: [string, number][] = [
    [',', (headerLine.match(/,/gu) ?? []).length],
    [';', (headerLine.match(/;/gu) ?? []).length],
    ['\t', (headerLine.match(/\t/gu) ?? []).length],
    ['|', (headerLine.match(/\|/gu) ?? []).length],
  ];
  candidates.sort((a, b) => b[1] - a[1]);
  return (candidates[0] as [string, number])[0];
}

export function loadCsv(path: string): Csv {
  const info = readFileInfo(path);
  const delimiter = detectDelimiter(info.lines[0] ?? '');
  const options = {
    delimiter,
    bom: false,
    relax_column_count: true,
    skip_empty_lines: false,
    trim: false,
    columns: false,
  } as const;

  let relaxedQuotes = false;
  let records: string[][];
  try {
    records = parse(info.text, options);
  } catch {
    // Only reached if the export contains quoting the strict reader rejects; the fallback
    // is recorded in the profile rather than hidden.
    relaxedQuotes = true;
    records = parse(info.text, { ...options, relax_quotes: true });
  }

  const header = records[0] ?? [];
  const rows = records.slice(1);
  const fieldCounts = new Counter();
  const raggedRows: number[] = [];
  let fieldsWithNewline = 0;
  rows.forEach((r, i) => {
    fieldCounts.add(String(r.length));
    if (r.length !== header.length) raggedRows.push(i);
    for (const f of r) if (/[\r\n]/u.test(f)) fieldsWithNewline++;
  });

  return {
    info,
    header,
    rows,
    delimiter,
    fieldCounts,
    relaxedQuotes,
    raggedRows,
    fieldsWithNewline,
  };
}

/** Column values in row order; a row missing the field yields `''`. */
export function column(csv: Csv, name: string): string[] {
  const idx = csv.header.indexOf(name);
  if (idx < 0) throw new Error(`${csv.info.name}: no column ${name}`);
  return csv.rows.map((r) => r[idx] ?? '');
}

export function delimiterLabel(d: string): string {
  return d === '\t' ? 'tab' : d === ',' ? 'comma' : d;
}
