// Byte-faithful JSON Lines reading for consents.jsonl (R-A8). One record per physical line; the
// five keys are validated once here (ADR-0003) and stored as text exactly as they appear.
import { z } from 'zod';

const TERMINATOR = /\r?\n$/u;

// Every line of the export carries exactly these five string keys (data-profile P-29). An extra,
// missing or non-string key in a future export is a change of format and stops the run.
export const consentLineSchema = z.strictObject({
  patient_legacy_id: z.string(),
  type: z.string(),
  action: z.string(),
  at: z.string(),
  version: z.string(),
});

export type ConsentLine = z.infer<typeof consentLineSchema>;

export interface JsonlRecord {
  /** 1-based physical line number, the raw table's primary key (ADR-0004). */
  readonly lineNo: number;
  /** The line's bytes as exported, without the terminator. */
  readonly raw: Uint8Array;
  readonly fields: ConsentLine;
}

export function parseConsentsJsonl(bytes: Uint8Array): JsonlRecord[] {
  const text = Buffer.from(bytes);
  const records: JsonlRecord[] = [];
  let offset = 0;
  let lineNo = 1;
  while (offset < text.length) {
    const nextBreak = text.indexOf(0x0a, offset);
    const end = nextBreak === -1 ? text.length : nextBreak + 1;
    const withTerminator = text.subarray(offset, end).toString('utf8');
    const line = withTerminator.replace(TERMINATOR, '');
    const raw = text.subarray(offset, offset + Buffer.byteLength(line, 'utf8'));
    records.push({ lineNo, raw, fields: parseLine(line, lineNo) });
    offset = end;
    lineNo += 1;
  }
  return records;
}

function parseLine(line: string, lineNo: number): ConsentLine {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    throw new Error(`consents.jsonl line ${lineNo}: not valid JSON`, { cause: error });
  }
  const result = consentLineSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`consents.jsonl line ${lineNo}: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}
