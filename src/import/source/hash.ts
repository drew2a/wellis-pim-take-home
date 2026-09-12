import { createHash } from 'node:crypto';

/** sha256 as lowercase hex, the form stored in `row_hash` and `import_runs.*_sha256`. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
