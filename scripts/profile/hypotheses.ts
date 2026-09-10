/**
 * Tests the mapping hypotheses raised by docs/profile/data-profile.md against the whole export and
 * writes docs/profile/data-hypotheses.md. Run with `npm run profile:hypotheses -- --as-of YYYY-MM-DD`.
 *
 * Why a separate script: the profile describes and refuses to pick a reading. A mapping rule
 * may only be inferred from the data once it has been tested against the whole export and
 * the result written down (CLAUDE.md §5). This file is that test. It still decides nothing;
 * the decisions are in docs/adr/.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXPORT_DIR, HYPOTHESES_MD, abs, asOfFromArgv, reproduceCommand } from './cli.js';
import {
  BMI_WINDOW,
  HEIGHT_BAND_EDGES,
  POUNDS_RATIO_EDGES,
  WEIGHT_BAND_EDGES,
  bmi,
  bmiInWindow,
} from './common.js';
import { column, loadCsv } from './csv.js';
import { classifyOrder } from './dates.js';
import { code, renderTable, table } from './report.js';
import { Counter, band, bandLabels, digitsOnly, fold, parseNumber, shape } from './util.js';

const asOf = asOfFromArgv();
const patients = loadCsv(join(EXPORT_DIR, 'patients.csv'));
const intakes = loadCsv(join(EXPORT_DIR, 'intakes.csv'));

const P = {
  id: column(patients, 'legacy_id'),
  name: column(patients, 'full_name'),
  email: column(patients, 'email'),
  dob: column(patients, 'dob'),
  bsn: column(patients, 'bsn'),
  phone: column(patients, 'phone'),
  weight: column(patients, 'weight'),
  unit: column(patients, 'weight_unit'),
  height: column(patients, 'height_cm'),
  status: column(patients, 'status'),
  signup: column(patients, 'signup_date'),
  source: column(patients, 'source'),
};
const I = {
  id: column(intakes, 'intake_id'),
  patient: column(intakes, 'legacy_patient_id'),
  submitted: column(intakes, 'submitted_at'),
  version: column(intakes, 'questionnaire_version'),
  weight: column(intakes, 'weight'),
  height: column(intakes, 'height'),
  alcohol: column(intakes, 'alcohol_units_week'),
  outcome: column(intakes, 'outcome'),
};

const rowByPatientId = new Map<string, number>();
P.id.forEach((id, i) => rowByPatientId.set(id, i));
const intakesByPatient = new Map<string, number[]>();
I.patient.forEach((pid, i) => {
  const list = intakesByPatient.get(pid) ?? [];
  list.push(i);
  intakesByPatient.set(pid, list);
});

// ---------------------------------------------------------------------------------------
// H-1  Date reading by shape: 9999-99-99 = Y-M-D, 99-99-9999 = D-M-Y, 99/99/9999 = M-D-Y.

interface Ymd {
  readonly y: number;
  readonly m: number;
  readonly d: number;
}

function readDateByShape(raw: string): Ymd | null {
  let m = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(raw);
  let ymd: Ymd | null = null;
  if (m) ymd = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  if ((m = /^(\d{2})-(\d{2})-(\d{4})$/u.exec(raw)))
    ymd = { y: Number(m[3]), m: Number(m[2]), d: Number(m[1]) };
  if ((m = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(raw)))
    ymd = { y: Number(m[3]), m: Number(m[1]), d: Number(m[2]) };
  if (!ymd) return null;
  const t = Date.UTC(ymd.y, ymd.m - 1, ymd.d);
  const back = new Date(t);
  const valid =
    back.getUTCFullYear() === ymd.y &&
    back.getUTCMonth() === ymd.m - 1 &&
    back.getUTCDate() === ymd.d;
  return valid ? ymd : null;
}

const iso = (x: Ymd): string =>
  `${x.y}-${String(x.m).padStart(2, '0')}-${String(x.d).padStart(2, '0')}`;
const days = (x: Ymd): number => Date.UTC(x.y, x.m - 1, x.d) / 86_400_000;

/** The rule's ordering for a shape, or null when the shape is not one of the three. */
function ruleOrder(raw: string): 'day-first' | 'month-first' | null {
  const s = shape(raw);
  if (s === '9999-99-99') return 'month-first'; // Y-M-D: month before day
  if (s === '99-99-9999') return 'day-first';
  if (s === '99/99/9999') return 'month-first';
  return null;
}

function counterexamples(values: readonly string[]): {
  tested: number;
  unambiguous: number;
  contradictions: string[];
  unreadable: string[];
} {
  let unambiguous = 0;
  const contradictions: string[] = [];
  const unreadable: string[] = [];
  for (const v of values) {
    const order = ruleOrder(v);
    if (order === null || readDateByShape(v) === null) {
      unreadable.push(v);
      continue;
    }
    const cls = classifyOrder(v);
    if (cls === 'day-first' || cls === 'month-first') {
      unambiguous++;
      if (cls !== order) contradictions.push(v);
    }
  }
  return { tested: values.length, unambiguous, contradictions, unreadable };
}

// ---------------------------------------------------------------------------------------
// Markdown helpers: the document is a list of lines; tables come from report.ts.

const out: string[] = [];
const h = (s: string): void => {
  out.push('', s, '');
};
const p = (s: string): void => {
  out.push(s, '');
};
function md(headers: readonly string[], rows: readonly (readonly (string | number)[])[]): void {
  out.push(
    ...renderTable(
      table(
        '',
        headers,
        rows.map((r) => r.map(String)),
      ),
    ),
  );
}
/** A number when the value parses as one (integer or decimal), else null. */
const num = (raw: string): number | null => {
  const x = parseNumber(raw);
  return x.ok ? x.value : null;
};
/** Counter rows in a fixed order (zero-filled), or sorted by key. */
function rowsOf(c: Counter, order?: readonly string[]): [string, number][] {
  return (order ?? c.keys()).map((k) => [k, c.get(k)]);
}

// ---------------------------------------------------------------------------------------

out.push(
  '# Hypotheses tested against the whole export',
  '',
  `Generated by \`${reproduceCommand('profile:hypotheses', asOf)}\`. Each section tests one reading of the data that`,
  '`docs/profile/data-profile.md` left open, and reports what the whole export says about it. Nothing here',
  'is a decision; the decisions cite these sections from `docs/adr/`.',
  `**Reference date: ${asOf}** (the \`--as-of\` argument); "future" below means after that date.`,
);

// H-1
h('## H-1 Dates: read the ordering from the shape');
p(
  'Rule under test: `9999-99-99` is year-month-day, `99-99-9999` is day-month-year, `99/99/9999` is month-day-year.',
);
p(
  'A counterexample is a value whose parts prove the opposite ordering (a part above 12 in the wrong position).',
);
const dateCols: [string, readonly string[]][] = [
  ['patients.csv.dob', P.dob],
  ['patients.csv.signup_date', P.signup],
  ['intakes.csv.submitted_at', I.submitted],
];
md(
  ['column', 'values', 'unambiguous values', 'counterexamples', 'not readable under the rule'],
  dateCols.map(([name, vals]) => {
    const c = counterexamples(vals);
    return [name, c.tested, c.unambiguous, c.contradictions.length, c.unreadable.length];
  }),
);

// Age at signup under the rule
const AGE_BANDS = ['< 0', '0 .. 10', '10 .. 16', '16 .. 18', '18 .. 100', '> 100'];
const ageBands = new Counter();
const under18: [string, string, string, string][] = [];
let ageComparable = 0;
P.dob.forEach((raw, i) => {
  const dob = readDateByShape(raw);
  const su = readDateByShape(P.signup[i] ?? '');
  if (!dob || !su) return;
  ageComparable++;
  const age = (days(su) - days(dob)) / 365.2425;
  const b =
    age < 0
      ? '< 0'
      : age < 10
        ? '0 .. 10'
        : age < 16
          ? '10 .. 16'
          : age < 18
            ? '16 .. 18'
            : age <= 100
              ? '18 .. 100'
              : '> 100';
  ageBands.add(b);
  if (age < 18 || age > 100) under18.push([P.id[i] ?? '', raw, P.signup[i] ?? '', age.toFixed(1)]);
});
h('### Age at signup under the rule');
p(`${ageComparable} rows have both dates readable.`);
md(['age band (years)', 'rows'], rowsOf(ageBands, AGE_BANDS));
md(
  ['legacy_id', 'dob', 'signup_date', 'age at signup'],
  under18
    .sort((a, b) => Number(a[3]) - Number(b[3]))
    .slice(0, 12)
    .map((r) => [code(r[0]), code(r[1]), code(r[2]), r[3]]),
);
p(`(first 12 of ${under18.length} rows outside 18 .. 100)`);

// Intake before signup under the rule
const GAP_BANDS = ['< 0', '0', '1 .. 30', '31 .. 365', '> 365'];
const gapBands = new Counter();
let gapComparable = 0;
let negative = 0;
I.submitted.forEach((raw, i) => {
  const pi = rowByPatientId.get(I.patient[i] ?? '');
  if (pi === undefined) return;
  const sub = readDateByShape(raw);
  const su = readDateByShape(P.signup[pi] ?? '');
  if (!sub || !su) return;
  gapComparable++;
  const gap = days(sub) - days(su);
  if (gap < 0) negative++;
  gapBands.add(
    gap < 0 ? '< 0' : gap === 0 ? '0' : gap <= 30 ? '1 .. 30' : gap <= 365 ? '31 .. 365' : '> 365',
  );
});
h('### Intake submitted before the patient row existed, under the rule');
p(
  `${gapComparable} intakes have a resolvable patient and both dates readable; ${negative} are dated before the patient's signup_date.`,
);
md(['submitted_at minus signup_date (days)', 'intakes'], rowsOf(gapBands, GAP_BANDS));

// Future under the rule
h(`### Dates after ${asOf} under the rule`);
const future = new Counter();
for (const [name, vals] of dateCols) {
  for (const v of vals) {
    const d = readDateByShape(v);
    if (d && iso(d) > asOf) future.add(name);
  }
}
md(
  ['column', `rows dated after ${asOf}`],
  dateCols.map(([name]) => [name, future.get(name)]),
);

// Cut-over: non-ISO shapes by year of the value itself (year is unambiguous in every shape)
h('### When the non-ISO shapes stop');
for (const [name, vals] of dateCols) {
  if (name.endsWith('.dob')) continue;
  const isoByYear = new Counter();
  const nonIsoByYear = new Counter();
  const latestNonIso = new Map<string, string>();
  for (const v of vals) {
    const d = readDateByShape(v);
    if (!d) continue;
    const y = String(d.y);
    if (shape(v) === '9999-99-99') {
      isoByYear.add(y);
      continue;
    }
    nonIsoByYear.add(y);
    const cur = latestNonIso.get(y);
    if (cur === undefined || iso(d) > cur) latestNonIso.set(y, iso(d));
  }
  const years = [...new Set([...isoByYear.keys(), ...nonIsoByYear.keys()])].sort();
  p(`**${name}**`);
  md(
    ['year', 'ISO shape', 'non-ISO shapes', 'latest non-ISO value'],
    years.map((y) => [y, isoByYear.get(y), nonIsoByYear.get(y), latestNonIso.get(y) ?? '']),
  );
}

// H-2
h("## H-2 Weight: what the unit column means, checked against the same patient's intakes");
p(
  'Rule under test: `lbs` rows are pounds, `kg` rows are kilograms, and rows with an empty unit are pounds too.',
);
p(
  'Test: for every patient with at least one intake, divide each intake weight by the patient-row weight. Intakes are always kilogram-scale (P-20: max 167.1), so a pounds row should give a ratio near 1 / 2.20462 = 0.454.',
);
const RATIO_NOTE: Record<string, string> = {
  '0.42 .. 0.49': ' (pounds)',
  '0.9 .. 1.1': ' (same unit)',
};
const ratioLabels = bandLabels(POUNDS_RATIO_EDGES);
const ratios = new Map<string, Counter>();
const noIntake = new Counter();
const oddRows: [string, string, string, string, string][] = [];
const weightMin = WEIGHT_BAND_EDGES[0] as number;
const weightMax = WEIGHT_BAND_EDGES[WEIGHT_BAND_EDGES.length - 1] as number;
P.weight.forEach((raw, i) => {
  const w = num(raw);
  const unit = P.unit[i] ?? '';
  if (w === null) return;
  const list = intakesByPatient.get(P.id[i] ?? '') ?? [];
  if (list.length === 0) {
    noIntake.add(unit);
    return;
  }
  const t = ratios.get(unit) ?? new Counter();
  const rs = list.map((ii) => num(I.weight[ii] ?? '')).filter((x): x is number => x !== null);
  for (const iw of rs) t.add(band(iw / w, POUNDS_RATIO_EDGES));
  ratios.set(unit, t);
  const hv = num(P.height[i] ?? '');
  const bmiKg = hv === null || hv <= 0 ? Number.NaN : bmi(w, hv);
  if (
    w < weightMin ||
    w >= weightMax ||
    (unit === 'kg' && !Number.isNaN(bmiKg) && !bmiInWindow(bmiKg))
  ) {
    oddRows.push([P.id[i] ?? '', raw, unit, P.height[i] ?? '', rs.join(', ')]);
  }
});
for (const unit of ['kg', 'lbs', '']) {
  const t = ratios.get(unit) ?? new Counter();
  p(`**weight_unit ${code(unit)}** (rows without any intake: ${noIntake.get(unit)})`);
  md(
    ['intake weight / patient weight', 'intakes'],
    ratioLabels.map((l) => [`${l}${RATIO_NOTE[l] ?? ''}`, t.get(l)]),
  );
}
h('### Rows that no unit explains');
p(
  `Patient weights below ${weightMin} or at ${weightMax} and above, and \`kg\` rows whose BMI falls outside ` +
    `${BMI_WINDOW.min} .. ${BMI_WINDOW.max}, with the same patient's intake weights.`,
);
md(
  ['legacy_id', 'weight', 'unit', 'height_cm', 'intake weights'],
  oddRows.map((r) => [code(r[0]), code(r[1]), code(r[2]), code(r[3]), r[4] || '(no intake)']),
);

// H-3 heights
const heightLo = HEIGHT_BAND_EDGES[2] as number;
const heightHi = HEIGHT_BAND_EDGES[3] as number;
h(`## H-3 Height: the values outside ${heightLo} .. ${heightHi}`);
p(
  `Patient rows whose height_cm is outside ${heightLo} .. ${heightHi}, with the same patient's intake heights and ` +
    'weights. EXPORT-NOTES.md says intake height is self-reported independently of the patient row.',
);
const oddHeights: string[][] = [];
P.height.forEach((raw, i) => {
  const hv = num(raw);
  if (hv === null || (hv >= heightLo && hv <= heightHi)) return;
  const list = intakesByPatient.get(P.id[i] ?? '') ?? [];
  oddHeights.push([
    code(P.id[i] ?? ''),
    code(raw),
    code(P.weight[i] ?? ''),
    list.map((ii) => I.height[ii] ?? '').join(', ') || '(no intake)',
    list.map((ii) => I.weight[ii] ?? '').join(', '),
  ]);
});
md(['legacy_id', 'height_cm', 'weight', 'intake heights', 'intake weights'], oddHeights);
let identicalHeights = 0;
let comparableHeights = 0;
I.height.forEach((raw, i) => {
  const pi = rowByPatientId.get(I.patient[i] ?? '');
  if (pi === undefined) return;
  comparableHeights++;
  if (raw === P.height[pi]) identicalHeights++;
});
p(
  `Across all resolvable intakes, ${identicalHeights} of ${comparableHeights} intake heights are byte-identical to the patient row's height_cm.`,
);

// H-4 vocabularies by source / version / year
h('## H-4 Vocabularies: which spelling comes from where');
const cross = (
  rowsA: readonly string[],
  rowsB: readonly string[],
  labelA: string,
  labelB: string,
  keyA: (s: string) => string = fold,
): void => {
  const t = new Counter();
  const as = new Set<string>();
  const bs = new Set<string>();
  rowsA.forEach((a, i) => {
    const ka = keyA(a);
    const kb = rowsB[i] ?? '';
    as.add(ka);
    bs.add(kb);
    t.add(`${ka}|${kb}`);
  });
  const bl = [...bs].sort();
  p(`**${labelA} (folded) x ${labelB}**`);
  md(
    [`${labelA} \\ ${labelB}`, ...bl.map(code), 'total'],
    [...as]
      .sort()
      .map((a) => [
        code(a),
        ...bl.map((b) => t.get(`${a}|${b}`)),
        bl.reduce((acc, b) => acc + t.get(`${a}|${b}`), 0),
      ]),
  );
};
cross(P.status, P.source, 'patients.status', 'source');
const yearOf = (raw: string): string => {
  const d = readDateByShape(raw);
  return d ? String(d.y) : '?';
};
cross(P.status, P.signup.map(yearOf), 'patients.status', 'signup year');
cross(I.outcome, I.version, 'intakes.outcome', 'questionnaire_version');
cross(
  I.version,
  I.submitted.map(yearOf),
  'intakes.questionnaire_version',
  'submitted year',
  (s) => s,
);
cross(I.alcohol, I.version, 'intakes.alcohol_units_week', 'questionnaire_version', (s) => s);

// H-5 duplicate candidates under the date rule
h('## H-5 Duplicate-patient candidates under the date rule');
p(
  'Groups of patient rows with the same folded full_name and the same date of birth once each dob is read by shape (H-1).',
);
const groups = new Map<string, number[]>();
P.name.forEach((n, i) => {
  const d = readDateByShape(P.dob[i] ?? '');
  if (!d) return;
  const k = `${fold(n)}|${iso(d)}`;
  const g = groups.get(k) ?? [];
  g.push(i);
  groups.set(k, g);
});
const dupGroups = [...groups.values()].filter((g) => g.length > 1);
const signal = new Counter();
for (const g of dupGroups) {
  const emails = new Set(g.map((i) => fold(P.email[i] ?? '')));
  const phones = new Set(g.map((i) => digitsOnly(P.phone[i] ?? '')).filter((x) => x !== ''));
  const bsns = new Set(g.map((i) => P.bsn[i] ?? '').filter((x) => x !== ''));
  signal.add(emails.size === 1 ? 'same folded email' : 'different emails');
  if (phones.size === 1 && g.every((i) => digitsOnly(P.phone[i] ?? '') !== ''))
    signal.add('same phone (all rows)');
  if (bsns.size === 1 && g.every((i) => (P.bsn[i] ?? '') !== '')) signal.add('same bsn (all rows)');
  if (g.every((i) => (intakesByPatient.get(P.id[i] ?? '') ?? []).length > 0))
    signal.add('every row has intakes');
}
p(
  `${dupGroups.length} groups over ${dupGroups.reduce((a, g) => a + g.length, 0)} rows (largest group ${Math.max(0, ...dupGroups.map((g) => g.length))}).`,
);
md(['signal within the group', 'groups'], rowsOf(signal));
h('### The groups whose rows have different emails');
const diffEmail = dupGroups.filter((g) => new Set(g.map((i) => fold(P.email[i] ?? ''))).size > 1);
md(
  [
    'group',
    'legacy_id',
    'full_name',
    'email',
    'dob',
    'phone',
    'bsn',
    'status',
    'signup_date',
    'intakes',
  ],
  diffEmail.flatMap((g, gi) =>
    g.map((i) => [
      gi + 1,
      code(P.id[i] ?? ''),
      code(P.name[i] ?? ''),
      code(P.email[i] ?? ''),
      code(P.dob[i] ?? ''),
      code(P.phone[i] ?? ''),
      code(P.bsn[i] ?? ''),
      code(P.status[i] ?? ''),
      code(P.signup[i] ?? ''),
      (intakesByPatient.get(P.id[i] ?? '') ?? []).length,
    ]),
  ),
);
h('### Rows sharing a bsn or a phone but not a name');
function groupBy(keys: readonly string[]): number[][] {
  const m = new Map<string, number[]>();
  keys.forEach((k, i) => {
    if (k === '') return;
    const g = m.get(k) ?? [];
    g.push(i);
    m.set(k, g);
  });
  return [...m.values()].filter((g) => g.length > 1);
}
const namesDiffer = (g: readonly number[]): boolean =>
  new Set(g.map((i) => fold(P.name[i] ?? ''))).size > 1;
const bsnGroups = groupBy(P.bsn);
const phoneGroups = groupBy(P.phone.map(digitsOnly));
const bsnDiffName = bsnGroups.filter(namesDiffer);
md(
  ['shared key', 'groups with more than one row', 'of which the names differ'],
  [
    ['bsn', bsnGroups.length, bsnDiffName.length],
    ['phone (digits only)', phoneGroups.length, phoneGroups.filter(namesDiffer).length],
  ],
);
md(
  ['bsn', 'legacy_id', 'full_name', 'dob', 'email'],
  bsnDiffName
    .slice(0, 6)
    .flatMap((g) =>
      g.map((i) => [
        code(P.bsn[i] ?? ''),
        code(P.id[i] ?? ''),
        code(P.name[i] ?? ''),
        code(P.dob[i] ?? ''),
        code(P.email[i] ?? ''),
      ]),
    ),
);
p(`(first 6 of ${bsnDiffName.length} bsn groups with differing names)`);

writeFileSync(abs(HYPOTHESES_MD), out.join('\n') + '\n');
console.log(`wrote ${HYPOTHESES_MD} (${out.length} lines), as of ${asOf}`);
