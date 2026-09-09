/**
 * Section registry, markdown rendering and the standard per-column inventory.
 *
 * Why a registry: the human document numbers every inventory `P-n` and the claim
 * verification cites those numbers. Numbering is therefore derived from the order in
 * which sections are added, never typed, so a new inventory cannot desynchronise the
 * cross-references.
 */
import {Counter, Grouper, KEY_SEP, collapsedShape, fold, hasEdgeWhitespace, shape} from './util.js';

/** Above this many distinct raw values a column is inventoried by shape, not by value. */
export const VALUE_TABLE_LIMIT = 60;

export interface Table {
  readonly caption: string;
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export interface Section {
  readonly key: string;
  readonly title: string;
  readonly group: 'inventory' | 'cross';
  readonly notes: readonly string[];
  readonly tables: readonly Table[];
  readonly json: Record<string, unknown>;
}

export function table(caption: string, header: readonly string[], rows: readonly (readonly string[])[]): Table {
  return {caption, header, rows};
}

/**
 * Renders a raw value as a markdown code span so leading and trailing whitespace stays
 * visible in the document source. `|` becomes `\|` and control characters become escapes,
 * because a table cell cannot carry them.
 */
export function code(raw: string): string {
  if (raw === '') return '(empty)';
  const shown = raw
    .replace(/\\/gu, '\\\\')
    .replace(/\t/gu, '\\t')
    .replace(/\r/gu, '\\r')
    .replace(/\n/gu, '\\n')
    .replace(/\|/gu, '\\|');
  const longestRun = [...shown.matchAll(/`+/gu)].reduce((n, m) => Math.max(n, m[0].length), 0);
  const fence = '`'.repeat(longestRun + 1);
  return `${fence}${shown}${fence}`;
}

export function plain(s: string): string {
  return s.replace(/\|/gu, '\\|');
}

export class Report {
  private readonly sections: Section[] = [];

  add(section: Section): Section {
    if (this.sections.some((s) => s.key === section.key)) throw new Error(`duplicate section key ${section.key}`);
    this.sections.push(section);
    return section;
  }

  all(): readonly Section[] {
    return this.sections;
  }

  /** `P-n` for a section key; throws rather than emitting a dangling reference. */
  pn(key: string): string {
    const i = this.sections.findIndex((s) => s.key === key);
    if (i < 0) throw new Error(`unknown section key ${key}`);
    return `P-${i + 1}`;
  }

  pnList(keys: readonly string[]): string {
    return keys.map((k) => this.pn(k)).join(', ');
  }
}

export function renderTable(t: Table): string[] {
  const out: string[] = [];
  if (t.caption !== '') out.push(`**${t.caption}**`, '');
  // An empty inventory is a finding in itself; say so in one line instead of a header-only table.
  if (t.rows.length === 0) {
    out.push('None.', '');
    return out;
  }
  out.push(`| ${t.header.join(' | ')} |`);
  out.push(`| ${t.header.map(() => '---').join(' | ')} |`);
  for (const r of t.rows) out.push(`| ${r.join(' | ')} |`);
  out.push('');
  return out;
}

export function renderSection(report: Report, s: Section, level: '##' | '###'): string[] {
  const out: string[] = [`${level} ${report.pn(s.key)} ${s.title}`, ''];
  for (const n of s.notes) out.push(n, '');
  for (const t of s.tables) out.push(...renderTable(t));
  return out;
}

export interface ColumnInput {
  readonly file: string;
  readonly column: string;
  readonly values: readonly string[];
  readonly notes?: readonly string[];
  readonly tables?: readonly Table[];
  readonly json?: Record<string, unknown>;
  /** `full_name` has too many exact shapes and no useful shape story; collapse instead. */
  readonly skipShapeTable?: boolean;
  /** Inventory by shape even though the distinct value count is small (heights, weights). */
  readonly forceShapeTable?: boolean;
}

export interface ColumnSection extends Section {
  readonly column: string;
  readonly file: string;
}

function valueTable(values: readonly string[]): Table {
  const c = new Counter();
  for (const v of values) c.add(v);
  return table(
    'Complete value inventory',
    ['raw value', 'count', 'folded'],
    c.entries().map((e) => [code(e.value), String(e.count), code(fold(e.value))]),
  );
}

function shapeTableOf(values: readonly string[], mode: 'exact' | 'collapsed'): Table {
  const g = new Grouper();
  for (const v of values) g.add(mode === 'exact' ? shape(v) : collapsedShape(v), v);
  return table(
    mode === 'exact' ? 'Complete shape inventory' : 'Complete collapsed-shape inventory',
    ['shape', 'count', 'examples'],
    g.entries().map((e) => [code(e.key), String(e.count), e.examples.map((x) => code(x)).join(' ')]),
  );
}

function charClasses(s: string): string {
  const cls: string[] = [];
  if (/\p{Ll}/u.test(s)) cls.push('lower');
  if (/\p{Lu}/u.test(s)) cls.push('upper');
  if (/\p{Nd}/u.test(s)) cls.push('digit');
  if (/[^\p{L}\p{Nd}]/u.test(s)) cls.push('other');
  return cls.length === 0 ? 'none' : cls.join('+');
}

function maskTable(values: readonly string[]): Table {
  const g = new Grouper();
  for (const v of values) g.add(`${v.length} | ${charClasses(v)}`, v);
  return table(
    'Complete length x character-class inventory',
    ['length', 'character classes', 'count', 'examples'],
    g.entries().map((e) => {
      const [len, classes] = e.key.split(' | ') as [string, string];
      return [len, classes, String(e.count), e.examples.map((x) => code(x)).join(' ')];
    }),
  );
}

/**
 * The inventory every column gets: counts, then either the full value table (few distinct
 * values) or a shape inventory. Which one is used is stated in the note, so a reader can
 * see that each row of the file lands in exactly one inventory row.
 */
export function columnSection(input: ColumnInput): ColumnSection {
  const {values} = input;
  const distinct = new Set(values);
  const distinctFolded = new Set(values.map((v) => fold(v)));
  const empty = values.filter((v) => v === '').length;
  const edgeWs = values.filter((v) => v !== '' && hasEdgeWhitespace(v));
  const edgeWsValues = new Set(edgeWs);
  const exactShapes = new Set(values.map((v) => shape(v)));
  const collapsed = new Set(values.map((v) => collapsedShape(v)));

  const notes: string[] = [];
  const tables: Table[] = [];
  const json: Record<string, unknown> = {
    rows: values.length,
    empty,
    distinct: distinct.size,
    distinctFolded: distinctFolded.size,
    edgeWhitespaceRows: edgeWs.length,
    edgeWhitespaceValues: edgeWsValues.size,
    distinctShapes: exactShapes.size,
    distinctCollapsedShapes: collapsed.size,
  };

  const head =
    `${values.length} rows, ${empty} empty, ${distinct.size} distinct raw values, ` +
    `${distinctFolded.size} distinct folded values, ${exactShapes.size} distinct shapes. ` +
    `${edgeWs.length} rows (${edgeWsValues.size} distinct values) carry leading or trailing whitespace.`;
  notes.push(head);

  const inventory: Array<{raw: string; count: number}> = [];
  const cnt = new Counter();
  for (const v of values) cnt.add(v);
  for (const e of cnt.entries()) inventory.push({raw: e.value, count: e.count});

  if (distinct.size <= VALUE_TABLE_LIMIT) json['values'] = inventory;

  if (distinct.size <= VALUE_TABLE_LIMIT && input.forceShapeTable !== true) {
    tables.push(valueTable(values));
  } else {
    const g = new Grouper();
    for (const v of values) g.add(shape(v), v);
    json['shapes'] = g.entries().map((e) => ({shape: e.key, count: e.count, examples: e.examples}));
    if (input.skipShapeTable === true) {
      notes.push(
        `Shapes are too diverse for a table here (${exactShapes.size} distinct exact shapes, ` +
          `${collapsed.size} distinct collapsed shapes); the complete exact-shape inventory is in ` +
          `docs/data-profile.json. The sub-analyses below carry the inventory instead.`,
      );
      tables.push(shapeTableOf(values, 'collapsed'));
    } else if (exactShapes.size <= VALUE_TABLE_LIMIT) {
      tables.push(shapeTableOf(values, 'exact'));
    } else if (collapsed.size <= VALUE_TABLE_LIMIT) {
      notes.push(
        `${exactShapes.size} distinct exact shapes is past the ${VALUE_TABLE_LIMIT}-row table limit, so the ` +
          `table below collapses runs of one shape character (\`aaa\` becomes \`a+\`); the complete ` +
          `exact-shape inventory is in docs/data-profile.json.`,
      );
      tables.push(shapeTableOf(values, 'collapsed'));
    } else {
      const g2 = new Grouper();
      for (const v of values) g2.add(`${v.length} | ${charClasses(v)}`, v);
      json['lengthClassInventory'] = g2.entries().map((e) => ({key: e.key, count: e.count, examples: e.examples}));
      notes.push(
        `Both the exact (${exactShapes.size}) and the collapsed (${collapsed.size}) shape inventories are past ` +
          `the ${VALUE_TABLE_LIMIT}-row table limit, so the table below inventories length and character ` +
          `classes; both shape inventories are complete in docs/data-profile.json.`,
      );
      tables.push(maskTable(values));
    }
  }

  for (const n of input.notes ?? []) notes.push(n);
  for (const t of input.tables ?? []) tables.push(t);
  for (const [k, v] of Object.entries(input.json ?? {})) json[k] = v;

  return {
    key: `${input.file}.${input.column}`,
    title: `${input.file}.${input.column}`,
    group: 'inventory',
    column: input.column,
    file: input.file,
    notes,
    tables,
    json,
  };
}

export function crossSection(
  key: string,
  title: string,
  notes: readonly string[],
  tables: readonly Table[],
  json: Record<string, unknown>,
): Section {
  return {key, title, group: 'cross', notes, tables, json};
}

/** Cross-tabulation renderer: rows x columns of counts, complete over observed keys. */
export function crossTab(
  caption: string,
  rowLabel: string,
  pairs: ReadonlyArray<readonly [string, string]>,
): Table {
  const rowKeys = [...new Set(pairs.map((p) => p[0]))].sort();
  const colKeys = [...new Set(pairs.map((p) => p[1]))].sort();
  const counts = new Counter();
  for (const [r, c] of pairs) counts.add(`${r}${KEY_SEP}${c}`);
  const rows = rowKeys.map((r) => [
    code(r),
    ...colKeys.map((c) => String(counts.get(`${r}${KEY_SEP}${c}`))),
    String(colKeys.reduce((t, c) => t + counts.get(`${r}${KEY_SEP}${c}`), 0)),
  ]);
  rows.push([
    '**total**',
    ...colKeys.map((c) => String(rowKeys.reduce((t, r) => t + counts.get(`${r}${KEY_SEP}${c}`), 0))),
    String(pairs.length),
  ]);
  return table(caption, [rowLabel, ...colKeys.map((c) => (c === '' ? '(empty)' : plain(c))), 'total'], rows);
}
