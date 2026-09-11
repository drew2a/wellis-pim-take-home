import { describe, expect, it } from 'vitest';

import { parseCsv, serialiseCsvRecord } from './csv';
import { EXPORT_FILES, readExportFiles } from './files';
import { sha256Hex } from './hash';
import { parseConsentsJsonl } from './jsonl';

const utf8 = (s: string): Uint8Array => Buffer.from(s, 'utf8');
const text = (b: Uint8Array): string => Buffer.from(b).toString('utf8');

describe('parseCsv', () => {
  it('keeps fields byte-faithful: whitespace, case, quotes, and numbers as text', () => {
    const rows = parseCsv(utf8('a,b,c\r\n x ,"y, z",007\r\n'), ['a', 'b', 'c']);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fields).toEqual([' x ', 'y, z', '007']);
    expect(rows[0]?.lineNo).toBe(2);
    expect(text(rows[0]?.raw ?? new Uint8Array())).toBe(' x ,"y, z",007');
  });

  it('numbers lines physically, so a quoted line break advances by two', () => {
    const rows = parseCsv(utf8('a,b\n1,"x\ny"\n2,z\n'), ['a', 'b']);
    expect(rows.map((r) => r.lineNo)).toEqual([2, 4]);
    expect(text(rows[0]?.raw ?? new Uint8Array())).toBe('1,"x\ny"');
  });

  it('accepts a final record without a terminator', () => {
    const rows = parseCsv(utf8('a,b\n1,2'), ['a', 'b']);
    expect(text(rows[0]?.raw ?? new Uint8Array())).toBe('1,2');
  });

  it('rejects a header that differs from the expected one', () => {
    expect(() => parseCsv(utf8('a,B\n1,2\n'), ['a', 'b'])).toThrow(/header mismatch/);
  });

  it('rejects a ragged record instead of skipping it', () => {
    expect(() => parseCsv(utf8('a,b\n1,2\n3\n'), ['a', 'b'])).toThrow(/line 3: expected 2 fields/);
  });
});

describe('serialiseCsvRecord', () => {
  it('quotes only fields that need it and doubles inner quotes', () => {
    expect(serialiseCsvRecord(['a', 'b c', 'd,e', 'f"g', ' h '])).toBe('a,b c,"d,e","f""g", h ');
  });
});

describe('parseConsentsJsonl', () => {
  const VALID =
    '{"patient_legacy_id": "rec1", "type": "data_processing", "action": "granted", "at": "2024-05-06T07:37:00", "version": "v2"}';
  it('keeps the line bytes and validates the five keys', () => {
    const line = VALID;
    const rows = parseConsentsJsonl(utf8(`${line}\n`));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.lineNo).toBe(1);
    expect(text(rows[0]?.raw ?? new Uint8Array())).toBe(line);
    expect(rows[0]?.fields.action).toBe('granted');
  });

  it('rejects a missing key, an extra key and a non-string value', () => {
    const base = { patient_legacy_id: 'r', type: 't', action: 'a', at: 'x', version: 'v' };
    const missing = { patient_legacy_id: 'r', type: 't', action: 'a', at: 'x' };
    expect(() => parseConsentsJsonl(utf8(JSON.stringify(missing)))).toThrow(/line 1/);
    expect(() => parseConsentsJsonl(utf8(JSON.stringify({ ...base, extra: 1 })))).toThrow(/line 1/);
    expect(() => parseConsentsJsonl(utf8(JSON.stringify({ ...base, version: 2 })))).toThrow(
      /line 1/,
    );
  });

  it('rejects a line that is not JSON, naming the line', () => {
    expect(() => parseConsentsJsonl(utf8(`${VALID}\nnot json\n`))).toThrow(/line 2/);
  });
});

// The proof behind R-A8: every record read from legacy_export/ re-serialises to the exact bytes
// of its physical line, and its hash is the hash of those bytes.
describe('legacy_export/ round-trips byte for byte', () => {
  const files = readExportFiles('legacy_export');

  it('reads the three files with their sizes on disk', () => {
    expect(Object.keys(files).sort()).toEqual([...EXPORT_FILES].sort());
    expect(files['patients.csv'].size).toBe(337327);
    expect(files['intakes.csv'].size).toBe(275640);
    expect(files['consents.jsonl'].size).toBe(362091);
  });

  it.each([
    [
      'patients.csv',
      [
        'legacy_id',
        'full_name',
        'email',
        'dob',
        'sex',
        'bsn',
        'phone',
        'city',
        'weight',
        'weight_unit',
        'height_cm',
        'status',
        'signup_date',
        'source',
      ],
      2466,
    ],
    [
      'intakes.csv',
      [
        'intake_id',
        'legacy_patient_id',
        'submitted_at',
        'questionnaire_version',
        'weight',
        'height',
        'meds_current',
        'conditions',
        'alcohol_units_week',
        'outcome',
        'reviewer_note',
      ],
      2917,
    ],
  ] as const)('%s: every record equals its source line', (name, header, count) => {
    const file = files[name];
    const lines = text(file.bytes).split('\r\n');
    const rows = parseCsv(file.bytes, header);
    expect(rows).toHaveLength(count);
    for (const row of rows) {
      const sourceLine = lines[row.lineNo - 1];
      expect(text(row.raw)).toBe(sourceLine);
      expect(serialiseCsvRecord(row.fields)).toBe(sourceLine);
      expect(sha256Hex(row.raw)).toBe(sha256Hex(utf8(sourceLine ?? '')));
    }
  });

  it('consents.jsonl: every record equals its source line', () => {
    const file = files['consents.jsonl'];
    const lines = text(file.bytes).split('\n');
    const rows = parseConsentsJsonl(file.bytes);
    expect(rows).toHaveLength(2643);
    for (const row of rows) {
      expect(text(row.raw)).toBe(lines[row.lineNo - 1]);
    }
  });
});
