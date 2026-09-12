import { eq } from 'drizzle-orm';

import { importRuns } from '@/db/schema';

import type { Queryable } from '@/db/queryable';
import type { ExportFiles } from './source/files';
import { IMPORTER_VERSION } from './version';

export interface RunOptions {
  readonly files: ExportFiles;
  /** `YYYY-MM-DD`; the reference date for every "future" judgement (ADR-0009 item 5). */
  readonly asOf: string;
  readonly dryRun: boolean;
}

/** Inserts the `import_runs` row and returns its id; the run's every other row points at it. */
export async function startRun(db: Queryable, options: RunOptions): Promise<number> {
  const { files } = options;
  const [row] = await db
    .insert(importRuns)
    .values({
      importerVersion: IMPORTER_VERSION,
      dryRun: options.dryRun,
      asOf: options.asOf,
      patientsSha256: files['patients.csv'].sha256,
      patientsBytes: files['patients.csv'].size,
      intakesSha256: files['intakes.csv'].sha256,
      intakesBytes: files['intakes.csv'].size,
      consentsSha256: files['consents.jsonl'].sha256,
      consentsBytes: files['consents.jsonl'].size,
    })
    .returning({ id: importRuns.id });
  if (row === undefined) {
    throw new Error('import_runs insert returned no row');
  }
  return row.id;
}

export async function finishRun(db: Queryable, runId: number): Promise<void> {
  await db.update(importRuns).set({ finishedAt: new Date() }).where(eq(importRuns.id, runId));
}

/**
 * The link between a run and the report it produced (ADR-0011 item 14): the report itself carries
 * no run id, so this column is where "which run wrote this file" is recorded. Null stays null for
 * a dry run, which prints the report and writes no file.
 */
export async function recordReportPath(
  db: Queryable,
  runId: number,
  reportPath: string,
): Promise<void> {
  await db.update(importRuns).set({ reportPath }).where(eq(importRuns.id, runId));
}
