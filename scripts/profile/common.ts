/**
 * Analyses shared by more than one column: date shapes and orderings, numeric bands,
 * and free-text term inventories. Facts and counts only; no column is interpreted here.
 */
import { code, plain, table, type Table } from './report.js';
import {
  Counter,
  Grouper,
  KEY_SEP,
  band,
  bandLabels,
  fmtNum,
  fold,
  numStats,
  parseNumber,
  shape,
} from './util.js';
import {
  TWO_DIGIT_YEAR_PIVOT,
  candidateDates,
  classifyOrder,
  splitDateParts,
  yearLabel,
  yearPosition,
  type OrderClass,
} from './dates.js';

/**
 * Band edges and windows shared by the profile and by the hypothesis tests, defined once so
 * the two documents band the same rows the same way. `band()` treats every edge as the
 * exclusive upper bound of the band below it.
 */
export const WEIGHT_BAND_EDGES: readonly number[] = [35, 60, 100, 150, 200, 300];
export const HEIGHT_BAND_EDGES: readonly number[] = [3, 100, 140, 220];
/** Intake value / patient value; 0.4..0.5 and 2..2.4 bracket the kilogram/pound factor 2.20462. */
export const RATIO_EDGES: readonly number[] = [0.4, 0.5, 0.9, 1.1, 2.0, 2.4];
/** The same, with 1 / 2.20462 = 0.454 bracketed tightly (0.42..0.49) for the weight-unit test. */
export const POUNDS_RATIO_EDGES: readonly number[] = [0.4, 0.42, 0.49, 0.9, 1.1, 2.0, 2.4];
/** A BMI outside this window is treated as implausible in the unit cross-checks. */
export const BMI_WINDOW = { min: 15, max: 70 } as const;

export function bmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return weightKg / (m * m);
}

export function bmiInWindow(x: number): boolean {
  return x >= BMI_WINDOW.min && x <= BMI_WINDOW.max;
}

export interface DateValueFacts {
  readonly raw: string;
  readonly shape: string;
  readonly order: OrderClass;
  readonly candidates: readonly string[];
  readonly year: string;
  readonly twoDigitYear: boolean;
}

export interface DateAnalysis {
  readonly facts: readonly DateValueFacts[];
  readonly notes: readonly string[];
  readonly tables: readonly Table[];
  readonly json: Record<string, unknown>;
  /** Shapes carrying both an unambiguous day-first and an unambiguous month-first value. */
  readonly mixedShapes: readonly string[];
}

function dateFacts(values: readonly string[]): DateValueFacts[] {
  return values.map((raw) => {
    const parts = splitDateParts(raw);
    const yp = yearPosition(parts);
    return {
      raw,
      shape: shape(raw),
      order: classifyOrder(raw),
      candidates: candidateDates(raw),
      year: yearLabel(raw),
      twoDigitYear: yp === 'assumed-last',
    };
  });
}

const ORDER_CLASSES: readonly OrderClass[] = [
  'day-first',
  'month-first',
  'ambiguous',
  'invalid',
  'not-three-parts',
];

/**
 * Shape table with the ordering classification per shape. A shape that carries both an
 * unambiguous day-first and an unambiguous month-first value is proof that the shape
 * itself is mixed, so that verdict gets its own column.
 */
export function dateAnalysis(values: readonly string[]): DateAnalysis {
  const facts = dateFacts(values);
  const byShape = new Map<string, DateValueFacts[]>();
  for (const f of facts) {
    const list = byShape.get(f.shape);
    if (list === undefined) byShape.set(f.shape, [f]);
    else list.push(f);
  }

  const rows: string[][] = [];
  const jsonShapes: Record<string, unknown>[] = [];
  const mixedShapes: string[] = [];
  const ordered = [...byShape.entries()].sort(
    (a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1),
  );
  for (const [sh, list] of ordered) {
    const c = new Counter();
    for (const f of list) c.add(f.order);
    const mixed = c.get('day-first') > 0 && c.get('month-first') > 0;
    if (mixed) mixedShapes.push(sh);
    rows.push([
      code(sh),
      String(list.length),
      ...ORDER_CLASSES.map((k) => String(c.get(k))),
      mixed ? 'yes' : 'no',
      list
        .slice(0, 3)
        .map((f) => code(f.raw))
        .join(' '),
    ]);
    jsonShapes.push({
      shape: sh,
      count: list.length,
      byOrderClass: Object.fromEntries(ORDER_CLASSES.map((k) => [k, c.get(k)])),
      mixed,
      examples: list.slice(0, 3).map((f) => f.raw),
    });
  }

  const twoDigitYears = facts.filter((f) => f.twoDigitYear).length;
  const noCandidate = facts.filter((f) => f.raw !== '' && f.candidates.length === 0).length;
  const multiCandidate = facts.filter((f) => f.candidates.length > 1).length;

  const notes = [
    `${multiCandidate} values parse to more than one calendar date across the plausible orderings, ` +
      `${twoDigitYears} values carry a two-digit year (pivot 00..${TWO_DIGIT_YEAR_PIVOT} to the 2000s), ` +
      `${noCandidate} non-empty values parse to no calendar date at all.`,
  ];

  const t = table(
    'Shape x ordering classification',
    ['shape', 'count', ...ORDER_CLASSES, 'shape mixes day-first and month-first', 'examples'],
    rows,
  );

  return {
    facts,
    notes,
    tables: [t],
    json: {
      shapes: jsonShapes,
      mixedShapes,
      twoDigitYears,
      valuesWithMultipleCandidateDates: multiCandidate,
      nonEmptyValuesWithNoCandidateDate: noCandidate,
    },
    mixedShapes,
  };
}

/** Cross-tab of date shape against another column's value. */
export function shapeCrossTab(
  caption: string,
  shapes: readonly string[],
  others: readonly string[],
  otherLabel: string,
): Table {
  const rowKeys = [...new Set(shapes)].sort();
  const colKeys = [...new Set(others)].sort();
  const c = new Counter();
  shapes.forEach((s, i) => {
    c.add(`${s}${KEY_SEP}${others[i] ?? ''}`);
  });
  const rows = rowKeys.map((r) => [
    code(r),
    ...colKeys.map((k) => String(c.get(`${r}${KEY_SEP}${k}`))),
    String(colKeys.reduce((t, k) => t + c.get(`${r}${KEY_SEP}${k}`), 0)),
  ]);
  rows.push([
    'total',
    ...colKeys.map((k) => String(rowKeys.reduce((t, r) => t + c.get(`${r}${KEY_SEP}${k}`), 0))),
    String(shapes.length),
  ]);
  return table(
    caption,
    [`shape \\ ${otherLabel}`, ...colKeys.map((k) => (k === '' ? '(empty)' : plain(k))), 'total'],
    rows,
  );
}

export interface FoldingMerge {
  readonly table: Table;
  readonly groups: number;
  readonly rows: number;
  readonly json: Record<string, unknown>[];
}

/** Folded values that more than one raw spelling maps to: what a folding rule would merge. */
export function foldingMerge(values: readonly string[]): FoldingMerge {
  const byFolded = new Map<string, Counter>();
  for (const v of values) {
    const f = fold(v);
    const c = byFolded.get(f);
    if (c === undefined) byFolded.set(f, new Counter());
    (byFolded.get(f) as Counter).add(v);
  }
  const merged = [...byFolded.entries()]
    .filter(([, c]) => c.size > 1)
    .sort((a, b) => b[1].total() - a[1].total() || (a[0] < b[0] ? -1 : 1));
  const rows = merged.reduce((t, [, c]) => t + c.total(), 0);
  return {
    table: table(
      'Folded values that more than one raw spelling maps to',
      ['folded value', 'distinct raw spellings', 'rows', 'raw spellings (count)'],
      merged.map(([f, c]) => [
        code(f),
        String(c.size),
        String(c.total()),
        c
          .entries()
          .map((e) => `${code(e.value)} ${e.count}`)
          .join(', '),
      ]),
    ),
    groups: merged.length,
    rows,
    json: merged.map(([f, c]) => ({
      folded: f,
      rawSpellings: c.entries().map((e) => ({ raw: e.value, count: e.count })),
      rows: c.total(),
    })),
  };
}

export interface NumericAnalysis {
  readonly parsed: readonly {
    readonly ok: boolean;
    readonly value: number;
    readonly separator: string;
  }[];
  readonly notes: readonly string[];
  readonly tables: readonly Table[];
  readonly json: Record<string, unknown>;
}

/**
 * Numeric read of a column: how many values parse, which decimal separators appear, the
 * distribution, and the band counts. Band edges are given by the caller because the
 * interesting bands differ per column (weights, heights, alcohol units).
 */
export function numericAnalysis(
  values: readonly string[],
  bandEdges: readonly number[],
  label: string,
): NumericAnalysis {
  const parsed = values.map((v) => parseNumber(v));
  const nums: number[] = [];
  const sepCounter = new Counter();
  const nonNumeric = new Grouper();
  values.forEach((v, i) => {
    const p = parsed[i] as { ok: boolean; value: number; separator: string };
    if (v === '') {
      sepCounter.add('(empty)');
      return;
    }
    if (!p.ok) {
      nonNumeric.add(v, v);
      sepCounter.add('(not numeric)');
      return;
    }
    nums.push(p.value);
    sepCounter.add(p.separator === '' ? 'none (integer)' : p.separator);
  });

  const stats = numStats(nums);
  const bandCounter = new Counter();
  for (const n of nums) bandCounter.add(band(n, bandEdges));

  const tables: Table[] = [
    table(
      'Band counts',
      ['band', 'count'],
      bandLabels(bandEdges).map((b) => [b, String(bandCounter.get(b))]),
    ),
  ];
  if (nonNumeric.size > 0) {
    tables.push(
      table(
        'Non-numeric non-empty values',
        ['raw value', 'count'],
        nonNumeric.entries().map((e) => [code(e.key), String(e.count)]),
      ),
    );
  }

  return {
    parsed,
    notes: [
      `${nums.length} of ${values.length} values parse as a number; ${nonNumeric.entries().reduce((t, e) => t + e.count, 0)} ` +
        `non-empty values do not. Decimal separators: ` +
        `${sepCounter
          .entries()
          .map((e) => `${e.value} ${e.count}`)
          .join(', ')}. Distribution of ${label}: ` +
        `n ${stats.n}, min ${fmtNum(stats.min)}, p5 ${fmtNum(stats.p5)}, median ${fmtNum(stats.median)}, ` +
        `p95 ${fmtNum(stats.p95)}, max ${fmtNum(stats.max)}.`,
    ],
    tables,
    json: {
      numeric: stats,
      separators: sepCounter.entries().map((e) => ({ separator: e.value, count: e.count })),
      bands: bandLabels(bandEdges).map((b) => ({ band: b, count: bandCounter.get(b) })),
      nonNumericValues: nonNumeric.entries().map((e) => ({ raw: e.key, count: e.count })),
    },
  };
}

export interface TermSpec {
  readonly label: string;
  readonly patterns: readonly string[];
}

const SEPARATORS: readonly (readonly [string, RegExp])[] = [
  [',', /,/u],
  [';', /;/u],
  [' en ', / en /u],
  [' and ', / and /u],
  ['/', /\//u],
  ['+', /\+/u],
  ['newline', /[\r\n]/u],
];

/** Heuristic only, and labelled as such in the document: values that read as "nothing". */
const EMPTY_LIKE =
  /^(geen|geen medicatie|geen bijzonderheden|none|no|nee|neen|n\/a|na|n\.?v\.?t\.?|nvt|nihil|niks|niet|-{1,3}|\.|x|0)$/u;

export interface FreeTextAnalysis {
  readonly notes: readonly string[];
  readonly tables: readonly Table[];
  readonly json: Record<string, unknown>;
}

/**
 * Free-text inventory: folded values, the separators that appear between multiple items,
 * per-term counts for a caller-supplied term list, and every token containing a probe
 * substring so misspellings surface without being guessed at.
 */
export function freeTextAnalysis(
  values: readonly string[],
  terms: readonly TermSpec[],
  tokenProbes: readonly string[],
  valueTableLimit = 60,
): FreeTextAnalysis {
  const folded = values.map((v) => fold(v));
  const foldedCounter = new Counter();
  for (const f of folded) foldedCounter.add(f);

  const emptyLike = foldedCounter
    .entries()
    .filter((e) => e.value !== '' && EMPTY_LIKE.test(e.value));
  const emptyLikeRows = emptyLike.reduce((t, e) => t + e.count, 0);

  const foldedEntries = foldedCounter.entries();
  // When the column's own value table already lists every value, only the empty-like subset
  // adds anything here; above the limit this is the only folded inventory in the document.
  const shown =
    foldedEntries.length <= valueTableLimit ? emptyLike : foldedEntries.slice(0, valueTableLimit);
  const separatorRows = SEPARATORS.map(([lbl, re]) => ({
    separator: lbl,
    rows: values.filter((v) => re.test(v)).length,
  }));
  const tables: Table[] = [
    table(
      foldedEntries.length <= valueTableLimit
        ? `Folded values matching the empty-like heuristic, of ${foldedEntries.length} distinct folded values`
        : `Top ${valueTableLimit} folded values of ${foldedEntries.length}`,
      ['folded value', 'count', 'matches the empty-like heuristic'],
      shown.map((e) => [
        code(e.value),
        String(e.count),
        e.value !== '' && EMPTY_LIKE.test(e.value) ? 'yes' : 'no',
      ]),
    ),
    table(
      'Separator occurrences (rows whose value contains the separator)',
      ['separator', 'rows'],
      separatorRows.map((r) => [code(r.separator), String(r.rows)]),
    ),
  ];

  const termRows: string[][] = [];
  const termJson: Record<string, unknown>[] = [];
  for (const t of terms) {
    const hits = folded.filter((f) => t.patterns.some((p) => f.includes(p)));
    const distinct = new Set(hits);
    termRows.push([
      plain(t.label),
      String(hits.length),
      String(distinct.size),
      [...distinct]
        .sort()
        .slice(0, 3)
        .map((x) => code(x))
        .join(' '),
    ]);
    termJson.push({
      term: t.label,
      patterns: t.patterns,
      rows: hits.length,
      distinctFoldedValues: distinct.size,
    });
  }
  tables.push(
    table(
      'Term counts (case-insensitive substring of the folded value)',
      ['term', 'rows', 'distinct folded values', 'examples'],
      termRows,
    ),
  );

  // Tokenisation for the misspelling probe: split on the separators seen above.
  const tokenCounter = new Counter();
  const tokenExample = new Map<string, string>();
  folded.forEach((f, i) => {
    if (f === '') return;
    for (const tok of f.split(/[,;/+\r\n]| en | and |\s+/u)) {
      const t = tok.trim();
      if (t === '') continue;
      tokenCounter.add(t);
      if (!tokenExample.has(t)) tokenExample.set(t, values[i] ?? '');
    }
  });
  const probeRows = tokenCounter
    .entries()
    .filter((e) => tokenProbes.some((p) => e.value.includes(p)))
    .map((e) => [
      code(e.value),
      String(e.count),
      terms.some((t) => t.patterns.some((p) => e.value.includes(p))) ? 'yes' : 'no',
      code(tokenExample.get(e.value) ?? ''),
    ]);
  tables.push(
    table(
      `Tokens containing ${tokenProbes.map((p) => `"${p}"`).join(', ')}`,
      ['folded token', 'count', 'covered by a term above', 'example raw value'],
      probeRows,
    ),
  );

  return {
    notes: [
      `${foldedCounter.size} distinct folded values. ${foldedCounter.get('')} rows are empty and ` +
        `${emptyLikeRows} rows carry one of ${emptyLike.length} folded values matching the empty-like ` +
        `heuristic (${emptyLike.map((e) => `\`${e.value}\``).join(', ')}).`,
    ],
    tables,
    json: {
      distinctFolded: foldedCounter.size,
      emptyRows: foldedCounter.get(''),
      emptyLike: emptyLike.map((e) => ({ folded: e.value, count: e.count })),
      foldedValues: foldedEntries.map((e) => ({ folded: e.value, count: e.count })),
      terms: termJson,
      probeTokens: probeRows.map((r) => ({
        token: r[0],
        count: Number(r[1]),
        coveredByTerm: r[2] === 'yes',
      })),
      separators: separatorRows,
    },
  };
}
