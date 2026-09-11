// What `npm run import` prints (the brief, item 7): counts per rule code and per review-item
// type and scope, plus the run's bookkeeping. Every number comes from the run, none is typed.
// The report files come in a later branch; this is the stdout form.
import type { ImportSummary } from '../run';

const line = (label: string, value: string | number): string => `  ${label.padEnd(48)} ${value}`;

function sortedEntries(record: Readonly<Record<string, number>>): [string, number][] {
  return Object.entries(record).sort(([a], [b]) => a.localeCompare(b));
}

export function formatSummary(s: ImportSummary): string {
  const out: string[] = [];
  out.push(`import run ${s.runId}${s.dryRun ? ' (dry run, rolled back)' : ''}`);
  out.push(line('importer version', s.importerVersion));
  out.push(line('as of', s.asOf));
  out.push('');
  out.push('files');
  for (const f of s.files) out.push(line(`${f.name} (${f.size} bytes)`, f.sha256));
  out.push('');
  out.push('raw rows (inserted / unchanged / changed since an earlier run / repeated)');
  for (const [table, c] of sortedEntries(
    Object.fromEntries(Object.entries(s.raw).map(([k, v]) => [k, v.inserted])),
  )) {
    const r = s.raw[table as keyof typeof s.raw];
    out.push(line(table, `${c} / ${r.unchanged} / ${r.changed} / ${r.repeated}`));
  }
  out.push('');
  out.push('rules applied (rows over the whole export)');
  for (const [code, n] of sortedEntries(s.rulesApplied)) out.push(line(code, n));
  out.push('');
  out.push('rules applied per field');
  for (const [key, n] of sortedEntries(s.rulesByField)) out.push(line(key, n));
  out.push(line('normalisation records inserted this run', s.recordsInserted));
  out.push('');
  out.push('canonical rows (inserted / updated)');
  out.push(
    line('patients', `${s.canonical.patients.inserted} / ${s.canonical.patients.updated ?? 0}`),
  );
  out.push(
    line('intakes', `${s.canonical.intakes.inserted} / ${s.canonical.intakes.updated ?? 0}`),
  );
  out.push(line('  of which orphans (patient_id null)', s.canonical.intakes.orphans));
  out.push(line('  audit entries inserted', s.canonical.intakes.auditEntriesInserted));
  out.push(
    line(
      'consent_events (inserted / no event possible)',
      `${s.canonical.consentEvents.inserted} / ${s.canonical.consentEvents.skipped}`,
    ),
  );
  out.push(line('consent wall times in the fall-back hour', s.consentTime.ambiguous));
  out.push(line('consent wall times in the spring gap', s.consentTime.nonexistent));
  out.push('');
  out.push('review items (type/scope, over the whole export)');
  for (const [key, n] of sortedEntries(s.reviewItems)) out.push(line(key, n));
  out.push(line('review items inserted this run', s.reviewItemsInserted));
  out.push(line('human-owned fields the mapping would change', s.humanOwnedConflicts));
  return out.join('\n');
}
