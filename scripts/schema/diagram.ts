// Renders the Mermaid erDiagram in docs/schema.md from src/db/schema.ts, so the picture cannot
// drift from the code. Group membership is the one thing the schema module does not know; it is
// declared here in ADR-0004's order and checked for completeness. Append-only tables come from
// src/db/append-only.ts, the same list the append-only test compares with pg_trigger.
//
//   npm run schema:diagram          rewrite the generated block
//   npm run schema:diagram -- --check   exit 1 if the block is stale (runs in npm run check)
import { readFileSync, writeFileSync } from 'node:fs';

import { getTableName, is } from 'drizzle-orm';
import { getTableConfig, isPgEnum, PgEnumColumn, PgTable } from 'drizzle-orm/pg-core';

import { APPEND_ONLY_TABLE_NAMES } from '../../src/db/append-only';
import * as schema from '../../src/db/schema';

const DOC = 'docs/schema.md';
const BEGIN = '<!-- BEGIN GENERATED: npm run schema:diagram -->';
const END = '<!-- END GENERATED -->';

interface Group {
  title: string;
  tables: string[];
}

// ADR-0004 "Tables", with "Records and decisions" split by ADR-0007's rule: what is evidence is
// immutable in the database; what is derived or decided is not.
const GROUPS: Group[] = [
  { title: 'import bookkeeping', tables: ['import_runs'] },
  {
    title: 'raw',
    tables: ['legacy_patients_raw', 'legacy_intakes_raw', 'legacy_consent_events_raw'],
  },
  { title: 'canonical', tables: ['patients', 'patient_legacy_ids', 'intakes', 'consent_states'] },
  { title: 'evidence', tables: ['consent_events', 'normalisation_records', 'audit_entries'] },
  { title: 'decisions', tables: ['review_items', 'eligibility_evaluations'] },
];

function tablesByName(): Map<string, PgTable> {
  const tables = new Map<string, PgTable>();
  for (const value of Object.values(schema)) {
    if (is(value, PgTable)) {
      tables.set(getTableName(value), value);
    }
  }
  return tables;
}

function assertGroupsCoverSchema(tables: Map<string, PgTable>): void {
  const grouped = GROUPS.flatMap((g) => g.tables);
  const missing = [...tables.keys()].filter((name) => !grouped.includes(name));
  const unknown = grouped.filter((name) => !tables.has(name));
  const duplicated = grouped.filter((name, i) => grouped.indexOf(name) !== i);
  if (missing.length > 0 || unknown.length > 0 || duplicated.length > 0) {
    throw new Error(
      `GROUPS out of step with src/db/schema.ts — missing: [${missing.join(', ')}], ` +
        `unknown: [${unknown.join(', ')}], duplicated: [${duplicated.join(', ')}]`,
    );
  }
  // ADR-0007's rule in group terms: raw and evidence are append-only, nothing else is.
  const locked = GROUPS.filter((g) => g.title === 'raw' || g.title === 'evidence')
    .flatMap((g) => g.tables)
    .sort((a, b) => a.localeCompare(b));
  const declared = [...APPEND_ONLY_TABLE_NAMES].sort((a, b) => a.localeCompare(b));
  if (locked.join(',') !== declared.join(',')) {
    throw new Error(
      `GROUPS raw+evidence [${locked.join(', ')}] differ from src/db/append-only.ts ` +
        `[${declared.join(', ')}]`,
    );
  }
}

// Mermaid attribute types allow no spaces.
function mermaidType(sqlType: string): string {
  return sqlType.replace('timestamp with time zone', 'timestamptz').replaceAll(' ', '');
}

function renderEntity(name: string, table: PgTable, group: string, appendOnly: boolean): string[] {
  const config = getTableConfig(table);
  const compositePk = new Set(config.primaryKeys.flatMap((pk) => pk.columns.map((c) => c.name)));
  const singleUnique = new Set(
    config.uniqueConstraints.filter((u) => u.columns.length === 1).map((u) => u.columns[0]?.name),
  );
  const fkColumns = new Set(
    config.foreignKeys.flatMap((fk) => fk.reference().columns.map((c) => c.name)),
  );

  const label = appendOnly ? `${name} — ${group}, append-only` : `${name} — ${group}`;
  const lines = [`  ${name}["${label}"] {`];
  for (const column of config.columns) {
    const keys: string[] = [];
    if (column.primary || compositePk.has(column.name)) keys.push('PK');
    if (fkColumns.has(column.name)) keys.push('FK');
    if (column.isUnique || singleUnique.has(column.name)) keys.push('UK');
    const notes: string[] = [];
    if (is(column, PgEnumColumn)) notes.push('enum');
    if (!column.notNull && !column.primary) notes.push('null');
    const parts = [mermaidType(column.getSQLType()), column.name];
    if (keys.length > 0) parts.push(keys.join(','));
    if (notes.length > 0) parts.push(`"${notes.join(', ')}"`);
    lines.push(`    ${parts.join(' ')}`);
  }
  lines.push('  }');
  return lines;
}

function renderRelationships(tables: Map<string, PgTable>): string[] {
  const lines: string[] = [];
  for (const group of GROUPS) {
    for (const name of group.tables) {
      const table = tables.get(name) as PgTable;
      for (const fk of getTableConfig(table).foreignKeys) {
        const { columns, foreignTable } = fk.reference();
        // Parent side: exactly one when every FK column is NOT NULL, zero or one otherwise.
        const parent = columns.every((column) => column.notNull) ? '||' : '|o';
        const label = columns.map((column) => column.name).join(', ');
        lines.push(`  ${getTableName(foreignTable)} ${parent}--o{ ${name} : "${label}"`);
      }
    }
  }
  return lines;
}

function renderEnums(): string[] {
  const lines = ['| enum | values |', '| --- | --- |'];
  const enums = Object.values(schema)
    .filter((value) => isPgEnum(value))
    .sort((a, b) => a.enumName.localeCompare(b.enumName));
  if (enums.length === 0) {
    throw new Error('no pgEnum exports found in src/db/schema.ts');
  }
  for (const e of enums) {
    lines.push(`| \`${e.enumName}\` | ${e.enumValues.map((v) => `\`${v}\``).join(', ')} |`);
  }
  return lines;
}

function renderBlock(): string {
  const tables = tablesByName();
  assertGroupsCoverSchema(tables);
  const appendOnly = APPEND_ONLY_TABLE_NAMES;

  const diagram = ['```mermaid', 'erDiagram'];
  for (const group of GROUPS) {
    diagram.push(`  %% ${group.title}`);
    for (const name of group.tables) {
      diagram.push(
        ...renderEntity(name, tables.get(name) as PgTable, group.title, appendOnly.has(name)),
      );
    }
  }
  diagram.push('  %% foreign keys', ...renderRelationships(tables), '```');

  const locked = [...appendOnly].sort((a, b) => a.localeCompare(b));
  return [
    BEGIN,
    '',
    `Generated from \`src/db/schema.ts\` and \`src/db/append-only.ts\` by \`npm run schema:diagram\`; do not edit by hand.`,
    `Append-only (UPDATE, DELETE and TRUNCATE rejected by trigger): ${locked.map((n) => `\`${n}\``).join(', ')}.`,
    '',
    ...diagram,
    '',
    ...renderEnums(),
    '',
    END,
  ].join('\n');
}

function main(): void {
  const check = process.argv.includes('--check');
  const current = readFileSync(DOC, 'utf8');
  const begin = current.indexOf(BEGIN);
  const end = current.indexOf(END);
  if (begin < 0 || end < 0 || end < begin) {
    throw new Error(`${DOC} must contain the markers ${BEGIN} and ${END}`);
  }
  const next = current.slice(0, begin) + renderBlock() + current.slice(end + END.length);
  if (next === current) {
    console.log(`${DOC}: diagram up to date`);
    return;
  }
  if (check) {
    console.error(`${DOC}: diagram is stale, run npm run schema:diagram`);
    process.exit(1);
  }
  writeFileSync(DOC, next);
  console.log(`${DOC}: diagram rewritten`);
}

main();
