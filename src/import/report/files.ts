// Where the import report lands and in what form. The JSON is the machine-readable statement and
// the Markdown is rendered from it, never written by hand; both are committed, so a diff of either
// is a change in the export or in the rules (ADR-0011 item 14).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderMarkdown } from './render';
import type { ImportReport } from './types';

export const REPORT_DIR = 'reports';
export const REPORT_JSON = 'import-report.json';
export const REPORT_MARKDOWN = 'import-report.md';

/** Two spaces and a trailing newline: a JSON file a reviewer reads and git diffs line by line. */
export const renderJson = (report: ImportReport): string => `${JSON.stringify(report, null, 2)}\n`;

export interface WrittenReport {
  readonly json: string;
  readonly markdown: string;
}

export function writeReport(report: ImportReport, dir: string = REPORT_DIR): WrittenReport {
  mkdirSync(dir, { recursive: true });
  const written = { json: join(dir, REPORT_JSON), markdown: join(dir, REPORT_MARKDOWN) };
  writeFileSync(written.json, renderJson(report), 'utf8');
  writeFileSync(written.markdown, renderMarkdown(report), 'utf8');
  return written;
}
