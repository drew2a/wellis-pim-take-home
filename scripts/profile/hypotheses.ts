/**
 * Tests the mapping hypotheses raised by docs/profile/data-profile.md against the whole export and
 * writes docs/profile/data-hypotheses.md. Run with `npm run profile:hypotheses`.
 *
 * Why a separate script: the profile describes and refuses to pick a reading. A mapping rule
 * may only be inferred from the data once it has been tested against the whole export and
 * the result written down (CLAUDE.md §5). This file is that test. It still decides nothing;
 * the decisions are in docs/adr/.
 */
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {EXPORT_DIR, HYPOTHESES_MD, abs} from './cli.js';
import {column, loadCsv} from './csv.js';
import {classifyOrder} from './dates.js';
import {fold, shape} from './util.js';

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
  if (m) ymd = {y: Number(m[1]), m: Number(m[2]), d: Number(m[3])};
  if ((m = /^(\d{2})-(\d{2})-(\d{4})$/u.exec(raw))) ymd = {y: Number(m[3]), m: Number(m[2]), d: Number(m[1])};
  if ((m = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(raw))) ymd = {y: Number(m[3]), m: Number(m[1]), d: Number(m[2])};
  if (!ymd) return null;
  const t = Date.UTC(ymd.y, ymd.m - 1, ymd.d);
  const back = new Date(t);
  const valid = back.getUTCFullYear() === ymd.y && back.getUTCMonth() === ymd.m - 1 && back.getUTCDate() === ymd.d;
  return valid ? ymd : null;
}

const iso = (x: Ymd): string => `${x.y}-${String(x.m).padStart(2, '0')}-${String(x.d).padStart(2, '0')}`;
const days = (x: Ymd): number => Date.UTC(x.y, x.m - 1, x.d) / 86_400_000;

/** The rule's ordering for a shape, or null when the shape is not one of the three. */
function ruleOrder(raw: string): 'day-first' | 'month-first' | null {
  const s = shape(raw);
  if (s === '9999-99-99') return 'month-first'; // Y-M-D: month before day
  if (s === '99-99-9999') return 'day-first';
  if (s === '99/99/9999') return 'month-first';
  return null;
}

function counterexamples(values: readonly string[]): {tested: number; unambiguous: number; contradictions: string[]; unreadable: string[]} {
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
  return {tested: values.length, unambiguous, contradictions, unreadable};
}

// ---------------------------------------------------------------------------------------
// Markdown helpers

const out: string[] = [];
const h = (s: string): void => {
  out.push('', s, '');
};
const p = (s: string): void => {
  out.push(s, '');
};
function table(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number>>): void {
  out.push(`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`);
  for (const r of rows) out.push(`| ${r.map(String).join(' | ')} |`);
  out.push('');
}
const code = (s: string): string => (s === '' ? '(empty)' : `\`${s}\``);
const num = (raw: string): number | null => (/^-?\d+(\.\d+)?$/u.test(raw) ? Number(raw) : null);

class Tally {
  private readonly m = new Map<string, number>();
  add(k: string, n = 1): void {
    this.m.set(k, (this.m.get(k) ?? 0) + n);
  }
  rows(order?: readonly string[]): Array<[string, number]> {
    const keys = order ?? [...this.m.keys()].sort();
    return keys.map((k) => [k, this.m.get(k) ?? 0]);
  }
}

// ---------------------------------------------------------------------------------------

out.push(
  '# Hypotheses tested against the whole export',
  '',
  'Generated by `npm run profile:hypotheses`. Each section tests one reading of the data that',
  '`docs/profile/data-profile.md` left open, and reports what the whole export says about it. Nothing here',
  'is a decision; the decisions cite these sections from `docs/adr/`.',
);

// H-1
h('## H-1 Dates: read the ordering from the shape');
p('Rule under test: `9999-99-99` is year-month-day, `99-99-9999` is day-month-year, `99/99/9999` is month-day-year.');
p('A counterexample is a value whose parts prove the opposite ordering (a part above 12 in the wrong position).');
const dateCols: Array<[string, readonly string[]]> = [
  ['patients.csv.dob', P.dob],
  ['patients.csv.signup_date', P.signup],
  ['intakes.csv.submitted_at', I.submitted],
];
table(
  ['column', 'values', 'unambiguous values', 'counterexamples', 'not readable under the rule'],
  dateCols.map(([name, vals]) => {
    const c = counterexamples(vals);
    return [name, c.tested, c.unambiguous, c.contradictions.length, c.unreadable.length];
  }),
);

// Age at signup under the rule
const ageBands = new Tally();
const under18: Array<[string, string, string, string]> = [];
let ageComparable = 0;
P.dob.forEach((raw, i) => {
  const dob = readDateByShape(raw);
  const su = readDateByShape(P.signup[i] ?? '');
  if (!dob || !su) return;
  ageComparable++;
  const age = (days(su) - days(dob)) / 365.2425;
  const band = age < 0 ? '< 0' : age < 10 ? '0 .. 10' : age < 16 ? '10 .. 16' : age < 18 ? '16 .. 18' : age <= 100 ? '18 .. 100' : '> 100';
  ageBands.add(band);
  if (age < 18 || age > 100) under18.push([P.id[i] ?? '', raw, P.signup[i] ?? '', age.toFixed(1)]);
});
h('### Age at signup under the rule');
p(`${ageComparable} rows have both dates readable.`);
table(['age band (years)', 'rows'], ageBands.rows(['< 0', '0 .. 10', '10 .. 16', '16 .. 18', '18 .. 100', '> 100']));
table(['legacy_id', 'dob', 'signup_date', 'age at signup'], under18.sort((a, b) => Number(a[3]) - Number(b[3])).slice(0, 12).map((r) => [code(r[0]), code(r[1]), code(r[2]), r[3]]));
p(`(first 12 of ${under18.length} rows outside 18 .. 100)`);

// Intake before signup under the rule
const gapBands = new Tally();
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
  gapBands.add(gap < 0 ? '< 0' : gap === 0 ? '0' : gap <= 30 ? '1 .. 30' : gap <= 365 ? '31 .. 365' : '> 365');
});
h('### Intake submitted before the patient row existed, under the rule');
p(`${gapComparable} intakes have a resolvable patient and both dates readable; ${negative} are dated before the patient's signup_date.`);
table(['submitted_at minus signup_date (days)', 'intakes'], gapBands.rows(['< 0', '0', '1 .. 30', '31 .. 365', '> 365']));

// Future / tail under the rule
h('### Dates after 2028-04-11 under the rule');
const tail = new Tally();
for (const [name, vals] of dateCols) for (const v of vals) { const d = readDateByShape(v); if (d && iso(d) > '2028-04-11') tail.add(name); }
table(['column', 'rows dated after 2028-04-11'], dateCols.map(([name]) => [name, tail.rows([name])[0]?.[1] ?? 0]));

// Cut-over: non-ISO shapes by year of the value itself (year is unambiguous in every shape)
h('### When the non-ISO shapes stop');
const byYear = new Map<string, Tally>();
for (const [name, vals] of dateCols) {
  if (name.endsWith('.dob')) continue;
  for (const v of vals) {
    const d = readDateByShape(v);
    if (!d) continue;
    const t = byYear.get(name) ?? new Tally();
    t.add(`${d.y}|${shape(v) === '9999-99-99' ? 'iso' : 'non-iso'}`);
    byYear.set(name, t);
  }
}
for (const [name, t] of byYear) {
  const years = [...new Set(t.rows().map(([k]) => k.split('|')[0] ?? ''))].sort();
  p(`**${name}**`);
  table(['year', 'ISO shape', 'non-ISO shapes', 'latest non-ISO value'], years.map((y) => {
    const latest = (name.includes('signup') ? P.signup : I.submitted)
      .filter((v) => shape(v) !== '9999-99-99')
      .map((v) => ({v, d: readDateByShape(v)}))
      .filter((x) => x.d && String(x.d.y) === y)
      .map((x) => iso(x.d as Ymd))
      .sort()
      .at(-1) ?? '';
    return [y, t.rows([`${y}|iso`])[0]?.[1] ?? 0, t.rows([`${y}|non-iso`])[0]?.[1] ?? 0, latest];
  }));
}

// H-2
h('## H-2 Weight: what the unit column means, checked against the same patient\'s intakes');
p('Rule under test: `lbs` rows are pounds, `kg` rows are kilograms, and rows with an empty unit are pounds too.');
p('Test: for every patient with at least one intake, divide each intake weight by the patient-row weight. Intakes are always kilogram-scale (P-20: max 167.1), so a pounds row should give a ratio near 1 / 2.20462 = 0.454.');
const ratioBand = (r: number): string => (r < 0.40 ? '< 0.40' : r < 0.42 ? '0.40 .. 0.42' : r <= 0.49 ? '0.42 .. 0.49 (pounds)' : r < 0.9 ? '0.49 .. 0.90' : r <= 1.1 ? '0.90 .. 1.10 (same unit)' : '> 1.10');
const bandOrder = ['< 0.40', '0.40 .. 0.42', '0.42 .. 0.49 (pounds)', '0.49 .. 0.90', '0.90 .. 1.10 (same unit)', '> 1.10'];
const ratios = new Map<string, Tally>();
const noIntake = new Tally();
const oddRows: Array<[string, string, string, string, string]> = [];
P.weight.forEach((raw, i) => {
  const w = num(raw);
  const unit = P.unit[i] ?? '';
  if (w === null) return;
  const list = intakesByPatient.get(P.id[i] ?? '') ?? [];
  if (list.length === 0) {
    noIntake.add(unit);
    return;
  }
  const t = ratios.get(unit) ?? new Tally();
  const rs = list.map((ii) => num(I.weight[ii] ?? '')).filter((x): x is number => x !== null);
  for (const iw of rs) t.add(ratioBand(iw / w));
  ratios.set(unit, t);
  const bmiKg = w / ((num(P.height[i] ?? '') ?? 0) / 100) ** 2;
  if (w < 35 || w >= 300 || (unit === 'kg' && (bmiKg < 15 || bmiKg > 70))) {
    oddRows.push([P.id[i] ?? '', raw, unit, P.height[i] ?? '', rs.join(', ')]);
  }
});
for (const unit of ['kg', 'lbs', '']) {
  const t = ratios.get(unit);
  p(`**weight_unit ${code(unit)}** (rows without any intake: ${noIntake.rows([unit])[0]?.[1] ?? 0})`);
  table(['intake weight / patient weight', 'intakes'], t ? t.rows(bandOrder) : bandOrder.map((b) => [b, 0]));
}
h('### Rows that no unit explains');
p('Patient weights below 35 or at 300 and above, and `kg` rows whose BMI falls outside 15 .. 70, with the same patient\'s intake weights.');
table(['legacy_id', 'weight', 'unit', 'height_cm', 'intake weights'], oddRows.map((r) => [code(r[0]), code(r[1]), code(r[2]), code(r[3]), r[4] || '(no intake)']));

// H-3 heights
h('## H-3 Height: the values outside 140 .. 220');
p('Patient rows whose height_cm is outside 140 .. 220, with the same patient\'s intake heights and weights. EXPORT-NOTES.md says intake height is self-reported independently of the patient row.');
const oddHeights: Array<string[]> = [];
P.height.forEach((raw, i) => {
  const hv = num(raw);
  if (hv === null || (hv >= 140 && hv <= 220)) return;
  const list = intakesByPatient.get(P.id[i] ?? '') ?? [];
  oddHeights.push([code(P.id[i] ?? ''), code(raw), code(P.weight[i] ?? ''), list.map((ii) => I.height[ii] ?? '').join(', ') || '(no intake)', list.map((ii) => I.weight[ii] ?? '').join(', ')]);
});
table(['legacy_id', 'height_cm', 'weight', 'intake heights', 'intake weights'], oddHeights);
let identicalHeights = 0;
let comparableHeights = 0;
I.height.forEach((raw, i) => {
  const pi = rowByPatientId.get(I.patient[i] ?? '');
  if (pi === undefined) return;
  comparableHeights++;
  if (raw === P.height[pi]) identicalHeights++;
});
p(`Across all resolvable intakes, ${identicalHeights} of ${comparableHeights} intake heights are byte-identical to the patient row's height_cm.`);

// H-4 vocabularies by source / version / year
h('## H-4 Vocabularies: which spelling comes from where');
const cross = (rowsA: readonly string[], rowsB: readonly string[], labelA: string, labelB: string, keyA: (s: string) => string = fold): void => {
  const t = new Tally();
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
  table([`${labelA} \\ ${labelB}`, ...bl.map(code), 'total'], [...as].sort().map((a) => [code(a), ...bl.map((b) => t.rows([`${a}|${b}`])[0]?.[1] ?? 0), bl.reduce((acc, b) => acc + (t.rows([`${a}|${b}`])[0]?.[1] ?? 0), 0)]));
};
cross(P.status, P.source, 'patients.status', 'source');
const yearOf = (raw: string): string => { const d = readDateByShape(raw); return d ? String(d.y) : '?'; };
cross(P.status, P.signup.map(yearOf), 'patients.status', 'signup year');
cross(I.outcome, I.version, 'intakes.outcome', 'questionnaire_version');
cross(I.version, I.submitted.map(yearOf), 'intakes.questionnaire_version', 'submitted year', (s) => s);
cross(I.alcohol, I.version, 'intakes.alcohol_units_week', 'questionnaire_version', (s) => s);

// H-5 duplicate candidates under the date rule
h('## H-5 Duplicate-patient candidates under the date rule');
p('Groups of patient rows with the same folded full_name and the same date of birth once each dob is read by shape (H-1).');
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
const signal = new Tally();
const digits = (s: string): string => s.replace(/\D/gu, '');
for (const g of dupGroups) {
  const emails = new Set(g.map((i) => fold(P.email[i] ?? '')));
  const phones = new Set(g.map((i) => digits(P.phone[i] ?? '')).filter((x) => x !== ''));
  const bsns = new Set(g.map((i) => P.bsn[i] ?? '').filter((x) => x !== ''));
  signal.add(emails.size === 1 ? 'same folded email' : 'different emails');
  if (phones.size === 1 && g.every((i) => digits(P.phone[i] ?? '') !== '')) signal.add('same phone (all rows)');
  if (bsns.size === 1 && g.every((i) => (P.bsn[i] ?? '') !== '')) signal.add('same bsn (all rows)');
  const sameIntakes = g.every((i) => (intakesByPatient.get(P.id[i] ?? '') ?? []).length > 0);
  if (sameIntakes) signal.add('every row has intakes');
}
p(`${dupGroups.length} groups over ${dupGroups.reduce((a, g) => a + g.length, 0)} rows (largest group ${Math.max(0, ...dupGroups.map((g) => g.length))}).`);
table(['signal within the group', 'groups'], signal.rows());
h('### The groups whose rows have different emails');
const diffEmail = dupGroups.filter((g) => new Set(g.map((i) => fold(P.email[i] ?? ''))).size > 1);
table(['group', 'legacy_id', 'full_name', 'email', 'dob', 'phone', 'bsn', 'status', 'signup_date', 'intakes'], diffEmail.flatMap((g, gi) => g.map((i) => [gi + 1, code(P.id[i] ?? ''), code(P.name[i] ?? ''), code(P.email[i] ?? ''), code(P.dob[i] ?? ''), code(P.phone[i] ?? ''), code(P.bsn[i] ?? ''), code(P.status[i] ?? ''), code(P.signup[i] ?? ''), (intakesByPatient.get(P.id[i] ?? '') ?? []).length])));
h('### Rows sharing a bsn or a phone but not a name');
const byBsn = new Map<string, number[]>();
P.bsn.forEach((b, i) => { if (b === '') return; const g = byBsn.get(b) ?? []; g.push(i); byBsn.set(b, g); });
const bsnDiffName = [...byBsn.values()].filter((g) => g.length > 1 && new Set(g.map((i) => fold(P.name[i] ?? ''))).size > 1);
const byPhone = new Map<string, number[]>();
P.phone.forEach((ph, i) => { const d = digits(ph); if (d === '') return; const g = byPhone.get(d) ?? []; g.push(i); byPhone.set(d, g); });
const phoneDiffName = [...byPhone.values()].filter((g) => g.length > 1 && new Set(g.map((i) => fold(P.name[i] ?? ''))).size > 1);
table(['shared key', 'groups with more than one row', 'of which the names differ'], [
  ['bsn', [...byBsn.values()].filter((g) => g.length > 1).length, bsnDiffName.length],
  ['phone (digits only)', [...byPhone.values()].filter((g) => g.length > 1).length, phoneDiffName.length],
]);
table(['bsn', 'legacy_id', 'full_name', 'dob', 'email'], bsnDiffName.slice(0, 6).flatMap((g) => g.map((i) => [code(P.bsn[i] ?? ''), code(P.id[i] ?? ''), code(P.name[i] ?? ''), code(P.dob[i] ?? ''), code(P.email[i] ?? '')])));
p(`(first 6 of ${bsnDiffName.length} bsn groups with differing names)`);

writeFileSync(abs(HYPOTHESES_MD), out.join('\n') + '\n');
console.log(`wrote ${HYPOTHESES_MD} (${out.length} lines)`);
