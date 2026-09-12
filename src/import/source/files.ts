// The export is exactly three files (ASSIGNMENT.md §2). They are read once, as bytes, and their
// size and sha256 go to `import_runs` so a run names the exact input it saw (ADR-0004).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sha256Hex } from './hash';

export const EXPORT_FILES = ['patients.csv', 'intakes.csv', 'consents.jsonl'] as const;
export type ExportFileName = (typeof EXPORT_FILES)[number];

export interface ExportFile {
  readonly name: ExportFileName;
  readonly bytes: Uint8Array;
  readonly size: number;
  readonly sha256: string;
}

export type ExportFiles = Readonly<Record<ExportFileName, ExportFile>>;

export function readExportFiles(dir: string): ExportFiles {
  const read = (name: ExportFileName): ExportFile => {
    const bytes = readFileSync(join(dir, name));
    return { name, bytes, size: bytes.byteLength, sha256: sha256Hex(bytes) };
  };
  return {
    'patients.csv': read('patients.csv'),
    'intakes.csv': read('intakes.csv'),
    'consents.jsonl': read('consents.jsonl'),
  };
}
