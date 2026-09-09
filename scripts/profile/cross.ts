/**
 * Cross-file inventories: duplicate-patient candidates, the observed date range per column
 * next to the reference date, and which columns change format with `source` or with year.
 *
 * Six independent groupings are reported side by side on purpose. Which of them a later
 * merge rule may trust is a decision for an ADR, not for this profile (CLAUDE.md §1).
 */
import type {Consents} from './consents.js';
import type {Intakes} from './intakes.js';
import type {Patients} from './patients.js';
import {candidateDates} from './dates.js';
import {code, crossSection, plain, table, type Section, type Table} from './report.js';
import {Counter, UnionFind, digitsOnly, fold, groupsByKey, shape} from './util.js';

export interface CrossContext {
  readonly patients: Patients;
  readonly intakes: Intakes;
  readonly consents: Consents;
  /** Reference date (`--as-of`): a value after it is "future". */
  readonly asOf: string;
}

interface Grouping {
  readonly id: string;
  readonly label: string;
  /** Row indices per group, groups of two or more rows only. */
  readonly groups: readonly (readonly number[])[];
}

function groupingFromKeys(id: string, label: string, keys: readonly string[]): Grouping {
  return {id, label, groups: [...groupsByKey(keys).values()]};
}

/** Rows that fall in any group of the grouping. */
function rowsIn(g: Grouping): Set<number> {
  const s = new Set<number>();
  for (const grp of g.groups) for (const r of grp) s.add(r);
  return s;
}

export function duplicateCandidateSection(ctx: CrossContext): Section {
  const p = ctx.patients;
  const n = p.csv.rows.length;

  const byEmail = groupingFromKeys('a', 'email, case-insensitive', p.email.map((v) => fold(v)));
  const byNameDobRaw = groupingFromKeys(
    'b',
    'folded full_name + raw dob string',
    p.fullName.map((v, i) => (fold(v) === '' || (p.dob[i] ?? '') === '' ? '' : `${fold(v)}||${p.dob[i] ?? ''}`)),
  );

  // (c) folded name plus any shared candidate date: union rows that share one reading.
  const uf = new UnionFind(n);
  const bucket = new Map<string, number[]>();
  p.fullName.forEach((name, i) => {
    const f = fold(name);
    if (f === '') return;
    for (const d of p.dobCandidates[i] ?? []) {
      const key = `${f}||${d}`;
      const list = bucket.get(key);
      if (list === undefined) bucket.set(key, [i]);
      else list.push(i);
    }
  });
  for (const rows of bucket.values()) for (let k = 1; k < rows.length; k++) uf.union(rows[0] as number, rows[k] as number);
  const byNameDobParsed: Grouping = {
    id: 'c',
    label: 'folded full_name + a dob candidate date in common',
    groups: uf.components(),
  };

  const byBsn = groupingFromKeys('d', 'bsn', p.bsn);
  const byPhone = groupingFromKeys('e', 'phone, digits only', p.phone.map((v) => digitsOnly(v)));
  const byName = groupingFromKeys('f', 'folded full_name only', p.fullName.map((v) => fold(v)));

  const all: Grouping[] = [byEmail, byNameDobRaw, byNameDobParsed, byBsn, byPhone, byName];
  /** Groups whose rows do not all share one folded email: the ops team's "signed up twice". */
  const groupsWithSeveralEmails = (g: Grouping): number =>
    g.groups.filter((grp) => new Set(grp.map((r) => fold(p.email[r] ?? ''))).size > 1).length;

  const summary = table(
    'Duplicate-patient candidate groupings',
    ['grouping', 'key', 'groups', 'rows involved', 'largest group', 'groups spanning more than one folded email'],
    all.map((g) => [
      g.id,
      plain(g.label),
      String(g.groups.length),
      String(rowsIn(g).size),
      String(g.groups.reduce((m, grp) => Math.max(m, grp.length), 0)),
      String(groupsWithSeveralEmails(g)),
    ]),
  );

  // Overlap of (c) and (e) with (a): where the groupings agree and where they do not.
  const emailRows = rowsIn(byEmail);
  const overlapRows: string[][] = [];
  const overlapJson: Array<Record<string, unknown>> = [];
  for (const g of [byNameDobParsed, byPhone]) {
    const rows = rowsIn(g);
    const both = [...rows].filter((r) => emailRows.has(r)).length;
    const onlyThis = rows.size - both;
    const onlyEmail = emailRows.size - both;
    const insideOneEmailGroup = g.groups.filter((grp) => {
      const keys = new Set(grp.map((r) => fold(p.email[r] ?? '')));
      return keys.size === 1 && !keys.has('');
    }).length;
    const withRowNotEmailDuplicated = g.groups.filter((grp) => grp.some((r) => !emailRows.has(r))).length;
    overlapRows.push([
      `(${g.id}) ${plain(g.label)}`,
      String(both),
      String(onlyThis),
      String(onlyEmail),
      String(n - both - onlyThis - onlyEmail),
      String(insideOneEmailGroup),
      String(withRowNotEmailDuplicated),
    ]);
    overlapJson.push({
      grouping: g.id,
      rowsInBoth: both,
      rowsOnlyInThisGrouping: onlyThis,
      rowsOnlyInEmailGrouping: onlyEmail,
      rowsInNeither: n - both - onlyThis - onlyEmail,
      groupsWhoseRowsShareOneFoldedEmail: insideOneEmailGroup,
      groupsWithARowThatHasNoEmailDuplicate: withRowNotEmailDuplicated,
    });
  }
  const overlap = table(
    'Overlap with grouping (a) email case-insensitive, counted in rows',
    [
      'grouping',
      'rows in both',
      'rows only here',
      'rows only in (a)',
      'rows in neither',
      'groups whose rows share one folded email',
      'groups with a row that has no email duplicate',
    ],
    overlapRows,
  );

  // Three example groups for (c), smallest row index first so the choice is deterministic.
  const exampleRows: string[][] = [];
  for (const grp of byNameDobParsed.groups.slice(0, 3)) {
    for (const r of grp) {
      exampleRows.push([
        String(byNameDobParsed.groups.indexOf(grp) + 1),
        code(p.legacyId[r] ?? ''),
        code(p.fullName[r] ?? ''),
        code(p.email[r] ?? ''),
        code(p.dob[r] ?? ''),
        code(p.signupDate[r] ?? ''),
      ]);
    }
  }
  const examples = table(
    'First three groups of grouping (c)',
    ['group', 'legacy_id', 'full_name', 'email', 'dob', 'signup_date'],
    exampleRows,
  );

  return crossSection(
    'cross.duplicate-candidates',
    'Duplicate-patient candidates',
    [
      `Six groupings over the ${n} patients.csv rows, each computed independently. Grouping (c) unions two rows ` +
        `when their folded names are equal and their dob values share at least one candidate date under the ` +
        `plausible orderings (year-first: Y-M-D, Y-D-M; year-last: D-M-Y, M-D-Y; all-two-digit: D-M-Y, M-D-Y, ` +
        `Y-M-D with the 00..26 pivot), so a row pair whose dob is written in different formats still groups.`,
      `Group counts are groups of two or more rows. A row can appear in several groupings; the overlap table ` +
        `states how far (c) and (e) agree with (a).`,
    ],
    [summary, overlap, examples],
    {
      groupings: all.map((g) => ({
        id: g.id,
        key: g.label,
        groups: g.groups.length,
        rowsInvolved: rowsIn(g).size,
        largestGroup: g.groups.reduce((m, grp) => Math.max(m, grp.length), 0),
        groupsSpanningSeveralFoldedEmails: groupsWithSeveralEmails(g),
        members: g.groups.map((grp) => grp.map((r) => p.legacyId[r] ?? '')),
      })),
      overlapWithEmailGrouping: overlapJson,
    },
  );
}

export interface DateRange {
  readonly earliest: string;
  readonly latest: string;
}

/** Earliest and latest candidate date over a column, dob excluded by the caller. */
export function columnRange(values: readonly string[]): DateRange {
  let earliest = '';
  let latest = '';
  for (const v of values) {
    const c = candidateDates(v);
    if (c.length === 0) continue;
    const lo = c[0] as string;
    const hi = c[c.length - 1] as string;
    if (earliest === '' || lo < earliest) earliest = lo;
    if (latest === '' || hi > latest) latest = hi;
  }
  return {earliest, latest};
}

export interface TailAnalysis {
  /** Last date of the bulk: the cluster of dates, separated by gaps wider than `gapDays`, with the most rows. */
  readonly bulkLatest: string;
  /** Rows dated before the bulk, i.e. early outliers. */
  readonly headRows: number;
  readonly tail: ReadonlyArray<{readonly date: string; readonly rows: number}>;
  readonly tailRows: number;
}

/**
 * Splits a date column into its bulk and an isolated tail.
 *
 * Why: the latest dates in this export sit decades after everything else. Whether a column's
 * extreme values are a boundary or a handful of outliers is a fact the reader needs next to
 * the future counts. The sorted dates are cut at every gap wider than `gapDays`; the bulk is
 * the cluster holding the most rows, not the first one, so a single early outlier cannot turn
 * the whole column into "tail". Nothing is derived from the result; the reference date is the
 * `--as-of` argument.
 */
export function isolatedTail(values: readonly string[], gapDays = 365): TailAnalysis {
  const counts = new Counter();
  for (const v of values) {
    const c = candidateDates(v);
    if (c.length > 0) counts.add(c[0] as string);
  }
  const dates = counts.keys();
  if (dates.length === 0) return {bulkLatest: '', headRows: 0, tail: [], tailRows: 0};
  const days = (iso: string): number => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
  const clusters: string[][] = [[dates[0] as string]];
  for (let i = 1; i < dates.length; i++) {
    const d = dates[i] as string;
    if (days(d) - days(dates[i - 1] as string) > gapDays) clusters.push([d]);
    else (clusters[clusters.length - 1] as string[]).push(d);
  }
  const rowsIn = (cluster: readonly string[]): number => cluster.reduce((t, d) => t + counts.get(d), 0);
  let bulk = 0;
  clusters.forEach((c, i) => {
    if (rowsIn(c) > rowsIn(clusters[bulk] as string[])) bulk = i;
  });
  const bulkCluster = clusters[bulk] as string[];
  const tail = clusters
    .slice(bulk + 1)
    .flat()
    .map((d) => ({date: d, rows: counts.get(d)}));
  return {
    bulkLatest: bulkCluster[bulkCluster.length - 1] as string,
    headRows: clusters.slice(0, bulk).reduce((t, c) => t + rowsIn(c), 0),
    tail,
    tailRows: tail.reduce((t, e) => t + e.rows, 0),
  };
}

export function dateRangeSection(ctx: CrossContext): Section {
  const p = ctx.patients;
  const it = ctx.intakes;
  const rows: Array<{label: string; range: DateRange; isoOnly: DateRange; tail: TailAnalysis}> = [];
  const isoOnly = (values: readonly string[]): readonly string[] => values.filter((v) => /^\d{4}-\d{2}-\d{2}/u.test(v));
  const add = (label: string, values: readonly string[]): void => {
    rows.push({label, range: columnRange(values), isoOnly: columnRange(isoOnly(values)), tail: isolatedTail(values)});
  };
  add('patients.csv.signup_date', p.signupDate);
  add('intakes.csv.submitted_at', it.submittedAt);
  add('consents.jsonl.at', ctx.consents.events.map((e) => e.at.slice(0, 10)));
  add('patients.csv.dob (excluded from the reference)', p.dob);

  return crossSection(
    'cross.date-range',
    'Earliest and latest dates across all files',
    [
      `Every "future" count in this profile is measured against the reference date ${ctx.asOf}, given on the ` +
        `command line with \`--as-of\`; no reference is derived from the data. The table shows the observed ` +
        `range per column under any plausible reading and, in the last two columns, under a strict ISO-only ` +
        `reading (values shaped \`9999-99-99\` only).`,
      `The second table lists each column's isolated tail. The sorted dates are cut at every gap of more than ` +
        `365 days; the bulk is the cluster holding the most rows, and the tail is everything after it, so the ` +
        `reader can see whether the extreme values are a boundary or a handful of outliers.`,
    ],
    [
      table(
        'Date range per column',
        ['column', 'earliest (any reading)', 'latest (any reading)', 'earliest (ISO-shaped only)', 'latest (ISO-shaped only)'],
        rows.map((r) => [
          plain(r.label),
          r.range.earliest,
          r.range.latest,
          r.isoOnly.earliest === '' ? '-' : r.isoOnly.earliest,
          r.isoOnly.latest === '' ? '-' : r.isoOnly.latest,
        ]),
      ),
      table(
        'Isolated tail per column: dates after the bulk (the largest cluster between gaps of more than 365 days), each row at its earliest candidate date',
        ['column', 'rows before the bulk', 'last date of the bulk', 'dates in the tail', 'rows in the tail'],
        rows.map((r) => [
          plain(r.label),
          String(r.tail.headRows),
          r.tail.bulkLatest,
          r.tail.tail.length === 0
            ? 'none'
            : r.tail.tail
                .slice(0, 6)
                .map((t) => `${t.date} (${t.rows})`)
                .join(', ') + (r.tail.tail.length > 6 ? `, and ${r.tail.tail.length - 6} more` : ''),
          String(r.tail.tailRows),
        ]),
      ),
    ],
    {
      asOf: ctx.asOf,
      perColumn: rows.map((r) => ({
        column: r.label,
        anyReading: r.range,
        isoShapedOnly: r.isoOnly,
        isolatedTail: {bulkLatest: r.tail.bulkLatest, headRows: r.tail.headRows, dates: r.tail.tail, rows: r.tail.tailRows},
      })),
      totalRowsInIsolatedTails: rows.reduce((t, r) => t + r.tail.tailRows, 0),
    },
  );
}

interface VariationSpec {
  readonly column: string;
  readonly values: readonly string[];
  /** `shape` compares formats, `folded value` compares vocabularies. */
  readonly dimension: 'shape' | 'folded value';
}

function variationRows(
  specs: readonly VariationSpec[],
  groupLabel: string,
  groupKeys: readonly string[],
): {rows: string[][]; json: Array<Record<string, unknown>>} {
  const rows: string[][] = [];
  const json: Array<Record<string, unknown>> = [];
  const groups = [...new Set(groupKeys)].sort();
  for (const spec of specs) {
    const normalise = spec.dimension === 'shape' ? shape : fold;
    const perGroup = new Map<string, Counter>();
    spec.values.forEach((v, i) => {
      const g = groupKeys[i] ?? '';
      const c = perGroup.get(g);
      if (c === undefined) perGroup.set(g, new Counter());
      (perGroup.get(g) as Counter).add(normalise(v));
    });
    const union = new Set<string>();
    for (const c of perGroup.values()) for (const k of c.keys()) union.add(k);
    const differs = [...perGroup.values()].some((c) => c.size !== union.size);
    if (!differs) continue;
    // One row per column: the per-group counts, then which values a group is missing.
    const missing = [...union]
      .sort()
      .map((k) => ({
        value: k,
        absentIn: groups.filter((g) => (perGroup.get(g) ?? new Counter()).get(k) === 0),
      }))
      .filter((m) => m.absentIn.length > 0);
    rows.push([
      plain(spec.column),
      spec.dimension,
      plain(groupLabel),
      groups.map((g) => `${g === '' ? '(empty)' : g} ${(perGroup.get(g) ?? new Counter()).size}`).join(', '),
      missing
        .slice(0, 6)
        .map((m) => `${code(m.value)} absent in ${m.absentIn.map((g) => (g === '' ? '(empty)' : g)).join(', ')}`)
        .join('; ') + (missing.length > 6 ? `; and ${missing.length - 6} more` : ''),
    ]);
    json.push({
      column: spec.column,
      dimension: spec.dimension,
      groupedBy: groupLabel,
      perGroup: groups.map((g) => ({
        group: g,
        distinct: (perGroup.get(g) ?? new Counter()).size,
        values: (perGroup.get(g) ?? new Counter()).entries().map((e) => ({value: e.value, count: e.count})),
      })),
    });
  }
  return {rows, json};
}

const VARIATION_HEADER = [
  'column',
  'compared as',
  'grouped by',
  'distinct per group',
  'values absent from at least one group',
] as const;

export function variationSection(ctx: CrossContext): Section {
  const p = ctx.patients;
  const it = ctx.intakes;
  const patientSpecs: VariationSpec[] = [
    {column: 'patients.csv.dob', values: p.dob, dimension: 'shape'},
    {column: 'patients.csv.signup_date', values: p.signupDate, dimension: 'shape'},
    {column: 'patients.csv.phone', values: p.phone, dimension: 'shape'},
    {column: 'patients.csv.weight', values: p.weight, dimension: 'shape'},
    {column: 'patients.csv.bsn', values: p.bsn, dimension: 'shape'},
    {column: 'patients.csv.sex', values: p.sex, dimension: 'folded value'},
    {column: 'patients.csv.status', values: p.status, dimension: 'folded value'},
    {column: 'patients.csv.city', values: p.city, dimension: 'folded value'},
    {column: 'patients.csv.weight_unit', values: p.weightUnit, dimension: 'folded value'},
  ];
  const signupYear = p.signupDate.map((v) => (candidateDates(v)[0] ?? '(unparsed)').slice(0, 4));
  const bySource = variationRows(patientSpecs, 'patients.csv.source', p.source);
  const byYear = variationRows(patientSpecs, 'signup year', signupYear);

  const intakeSpecs: VariationSpec[] = [
    {column: 'intakes.csv.submitted_at', values: it.submittedAt, dimension: 'shape'},
    {column: 'intakes.csv.weight', values: it.weight, dimension: 'shape'},
    {column: 'intakes.csv.height', values: it.height, dimension: 'shape'},
    {column: 'intakes.csv.alcohol_units_week', values: it.alcohol, dimension: 'folded value'},
    {column: 'intakes.csv.outcome', values: it.outcome, dimension: 'folded value'},
    {column: 'intakes.csv.reviewer_note', values: it.reviewerNote, dimension: 'folded value'},
    {column: 'intakes.csv.meds_current', values: it.meds, dimension: 'folded value'},
  ];
  const submittedYear = it.submittedAt.map((v) => (candidateDates(v)[0] ?? '(unparsed)').slice(0, 4));
  const byVersion = variationRows(intakeSpecs, 'intakes.csv.questionnaire_version', it.version);
  const byIntakeYear = variationRows(intakeSpecs, 'submitted year', submittedYear);

  const tables: Table[] = [
    table('patients.csv columns whose inventory differs by source', [...VARIATION_HEADER], bySource.rows),
    table('patients.csv columns whose inventory differs by signup year', [...VARIATION_HEADER], byYear.rows),
    table('intakes.csv columns whose inventory differs by questionnaire_version', [...VARIATION_HEADER], byVersion.rows),
    table('intakes.csv columns whose inventory differs by submitted year', [...VARIATION_HEADER], byIntakeYear.rows),
  ];

  return crossSection(
    'cross.variation',
    'Columns whose value set or format changes with source or with year',
    [
      `A column is listed when at least one group is missing a value or shape that another group has. Years are ` +
        `taken from the earliest candidate reading of the row's own date. Shapes compare format, folded values ` +
        `compare vocabulary; a column can appear under both.`,
    ],
    tables,
    {
      bySource: bySource.json,
      bySignupYear: byYear.json,
      byQuestionnaireVersion: byVersion.json,
      bySubmittedYear: byIntakeYear.json,
    },
  );
}

export function crossSections(ctx: CrossContext): Section[] {
  return [duplicateCandidateSection(ctx), dateRangeSection(ctx), variationSection(ctx)];
}
