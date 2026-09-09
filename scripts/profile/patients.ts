/**
 * Inventories for `legacy_export/patients.csv`.
 *
 * Every sub-analysis reports counts. Where a check needs a rule (the elfproef, a syntax
 * regex, an age window), the rule is stated in the note next to the number so the reader
 * can disagree with the rule without doubting the count.
 */
import {column, type Csv} from './csv.js';
import {candidateDates} from './dates.js';
import {
  BMI_WINDOW,
  HEIGHT_BAND_EDGES,
  WEIGHT_BAND_EDGES,
  bmi,
  bmiInWindow,
  dateAnalysis,
  foldingMerge,
  numericAnalysis,
  shapeCrossTab,
} from './common.js';
import {code, columnSection, crossTab, plain, table, type Section, type Table} from './report.js';
import {
  Counter,
  Grouper,
  STATS_HEADER,
  bandLabels,
  fmtNum,
  digitsOnly,
  fold,
  hasDiacritics,
  hasDoubleSpace,
  hasEdgeWhitespace,
  numStats,
  parseNumber,
  statsRow,
  unusualNameChars,
} from './util.js';

export interface Patients {
  readonly csv: Csv;
  readonly legacyId: readonly string[];
  readonly fullName: readonly string[];
  readonly email: readonly string[];
  readonly dob: readonly string[];
  readonly sex: readonly string[];
  readonly bsn: readonly string[];
  readonly phone: readonly string[];
  readonly city: readonly string[];
  readonly weight: readonly string[];
  readonly weightUnit: readonly string[];
  readonly heightCm: readonly string[];
  readonly status: readonly string[];
  readonly signupDate: readonly string[];
  readonly source: readonly string[];
  /** legacy_id -> row indices (a list, because uniqueness is a finding, not an assumption). */
  readonly byLegacyId: ReadonlyMap<string, readonly number[]>;
  readonly signupCandidates: ReadonlyArray<readonly string[]>;
  readonly dobCandidates: ReadonlyArray<readonly string[]>;
}

export function loadPatients(csv: Csv): Patients {
  const legacyId = column(csv, 'legacy_id');
  const byLegacyId = new Map<string, number[]>();
  legacyId.forEach((id, i) => {
    const list = byLegacyId.get(id);
    if (list === undefined) byLegacyId.set(id, [i]);
    else list.push(i);
  });
  const signupDate = column(csv, 'signup_date');
  const dob = column(csv, 'dob');
  return {
    csv,
    legacyId,
    fullName: column(csv, 'full_name'),
    email: column(csv, 'email'),
    dob,
    sex: column(csv, 'sex'),
    bsn: column(csv, 'bsn'),
    phone: column(csv, 'phone'),
    city: column(csv, 'city'),
    weight: column(csv, 'weight'),
    weightUnit: column(csv, 'weight_unit'),
    heightCm: column(csv, 'height_cm'),
    status: column(csv, 'status'),
    signupDate,
    source: column(csv, 'source'),
    byLegacyId,
    signupCandidates: signupDate.map((v) => candidateDates(v)),
    dobCandidates: dob.map((v) => candidateDates(v)),
  };
}

const FILE = 'patients.csv';
const ELFPROEF_WEIGHTS = [9, 8, 7, 6, 5, 4, 3, 2, -1] as const;

/** The Dutch BSN check: sum(digit * weight) mod 11 == 0 over exactly nine digits. */
export function elfproef(nineDigits: string): boolean {
  if (!/^\d{9}$/u.test(nineDigits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(nineDigits[i]) * (ELFPROEF_WEIGHTS[i] as number);
  return sum % 11 === 0;
}

function lengthTable(values: readonly string[]): Table {
  const c = new Counter();
  for (const v of values) c.add(String(v.length));
  return table(
    'Length distribution (characters)',
    ['length', 'count'],
    c
      .entries()
      .sort((a, b) => Number(a.value) - Number(b.value))
      .map((e) => [e.value, String(e.count)]),
  );
}

interface DupStats {
  /** Values carried by more than one row, count desc. */
  readonly entries: ReadonlyArray<{readonly value: string; readonly count: number}>;
  readonly groups: number;
  readonly rows: number;
}

/** Duplicate detection over non-empty values; empties are never a duplicate finding. */
function duplicateStats(values: readonly string[]): DupStats {
  const c = new Counter();
  for (const v of values) if (v !== '') c.add(v);
  const entries = c.entries().filter((e) => e.count > 1);
  return {entries, groups: entries.length, rows: entries.reduce((t, e) => t + e.count, 0)};
}

function duplicateTable(stats: DupStats, caption: string, limit = 12): Table {
  return table(
    `${caption}${stats.groups > limit ? ` (first ${limit} of ${stats.groups})` : ''}`,
    ['value', 'rows'],
    stats.entries.slice(0, limit).map((e) => [code(e.value), String(e.count)]),
  );
}

export interface PatientsContext {
  /** Reference date (`--as-of`): a value after it is "future". */
  readonly asOf: string;
}

export function patientsSections(p: Patients, ctx: PatientsContext): Section[] {
  const n = p.csv.rows.length;
  const sections: Section[] = [];

  // ---- legacy_id ----------------------------------------------------------------
  const idDup = duplicateStats(p.legacyId);
  const prefix = new Counter();
  for (const v of p.legacyId) prefix.add(v.slice(0, 3));
  sections.push(
    columnSection({
      file: FILE,
      column: 'legacy_id',
      values: p.legacyId,
      notes: [
        `${new Set(p.legacyId).size} distinct ids over ${n} rows, so ${idDup.groups} id values are carried by ` +
          `more than one row (${idDup.rows} rows involved). Prefixes seen: ` +
          `${prefix.entries().map((e) => `${code(e.value)} ${e.count}`).join(', ')}.`,
      ],
      tables: [lengthTable(p.legacyId), duplicateTable(idDup, 'Duplicate legacy_id values')],
      json: {duplicateGroups: idDup.groups, duplicateRows: idDup.rows},
    }),
  );

  // ---- full_name ----------------------------------------------------------------
  const tokenCounts = new Counter();
  for (const v of p.fullName) tokenCounts.add(String(fold(v) === '' ? 0 : fold(v).split(' ').length));
  const withDigits = p.fullName.filter((v) => /\d/u.test(v));
  const unusual = new Grouper();
  for (const v of p.fullName) for (const ch of unusualNameChars(v)) unusual.add(ch, v);
  const diacritics = p.fullName.filter((v) => hasDiacritics(v));
  const letters = (s: string): string => s.replace(/[^\p{L}]/gu, '');
  const allLower = p.fullName.filter((v) => letters(v) !== '' && v === v.toLowerCase());
  const allCaps = p.fullName.filter((v) => letters(v) !== '' && v === v.toUpperCase());
  const nameExactDup = duplicateStats(p.fullName);
  const nameFoldedDup = duplicateStats(p.fullName.map((v) => fold(v)));
  // Folded names that several raw spellings map to: what folding actually joins. This is not
  // the difference of the two group counts above, which nets joins against groups folding leaves.
  const nameMerge = foldingMerge(p.fullName);
  sections.push(
    columnSection({
      file: FILE,
      column: 'full_name',
      values: p.fullName,
      skipShapeTable: true,
      notes: [
        `${p.fullName.filter((v) => hasEdgeWhitespace(v)).length} rows have leading or trailing whitespace, ` +
          `${p.fullName.filter((v) => hasDoubleSpace(v)).length} rows have a double space inside the name, ` +
          `${withDigits.length} rows contain a digit, ${diacritics.length} rows contain a diacritic or other ` +
          `non-ASCII character, ${allLower.length} rows are all lowercase and ${allCaps.length} rows are ALL CAPS.`,
        `Exact duplicates: ${nameExactDup.groups} groups over ${nameExactDup.rows} rows. Duplicates after ` +
          `folding (trim + lowercase + collapse whitespace): ${nameFoldedDup.groups} groups over ` +
          `${nameFoldedDup.rows} rows. ${nameMerge.groups} folded names have more than one raw spelling, ` +
          `covering ${nameMerge.rows} rows.`,
      ],
      tables: [
        table(
          'Token count (folded value split on spaces)',
          ['tokens', 'rows'],
          tokenCounts
            .entries()
            .sort((a, b) => Number(a.value) - Number(b.value))
            .map((e) => [e.value, String(e.count)]),
        ),
        table(
          'Characters outside letters, marks, space, apostrophe, hyphen and dot',
          ['character', 'rows', 'examples'],
          unusual.entries().map((e) => [code(e.key), String(e.count), e.examples.map((x) => code(x)).join(' ')]),
        ),
        table(
          'Rows containing a digit (up to 20 shown)',
          ['raw value', 'count'],
          [...new Set(withDigits)]
            .sort()
            .slice(0, 20)
            .map((v) => [code(v), String(withDigits.filter((x) => x === v).length)]),
        ),
      ],
      json: {
        tokenCounts: tokenCounts.entries().map((e) => ({tokens: Number(e.value), rows: e.count})),
        rowsWithDigits: withDigits.length,
        rowsWithDiacritics: diacritics.length,
        allLowercaseRows: allLower.length,
        allCapsRows: allCaps.length,
        doubleSpaceRows: p.fullName.filter((v) => hasDoubleSpace(v)).length,
        exactDuplicateGroups: nameExactDup.groups,
        exactDuplicateRows: nameExactDup.rows,
        foldedDuplicateGroups: nameFoldedDup.groups,
        foldedDuplicateRows: nameFoldedDup.rows,
        foldingMergeGroups: nameMerge.groups,
        foldingMergeRows: nameMerge.rows,
        unusualCharacters: unusual.entries().map((e) => ({character: e.key, rows: e.count, examples: e.examples})),
      },
    }),
  );

  // ---- email --------------------------------------------------------------------
  const SYNTAX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u;
  const emailFailures = [...new Set(p.email.filter((v) => !SYNTAX.test(v.trim())))].sort();
  const hasUpper = p.email.filter((v) => /\p{Lu}/u.test(v));
  const internalWs = p.email.filter((v) => /\s/u.test(v.trim()));
  const domains = new Counter();
  const locals = new Map<string, Set<string>>();
  const localRows = new Counter();
  for (const v of p.email) {
    const t = fold(v);
    const at = t.lastIndexOf('@');
    if (at < 0) continue;
    const local = t.slice(0, at);
    const domain = t.slice(at + 1);
    domains.add(domain);
    localRows.add(local);
    const set = locals.get(local);
    if (set === undefined) locals.set(local, new Set([domain]));
    else set.add(domain);
  }
  const localMulti = [...locals.entries()].filter(([, d]) => d.size > 1);
  const emailExact = duplicateStats(p.email);
  const emailFolded = duplicateStats(p.email.map((v) => fold(v)));
  const plusAddr = p.email.filter((v) => v.includes('+'));
  sections.push(
    columnSection({
      file: FILE,
      column: 'email',
      values: p.email,
      notes: [
        `${hasUpper.length} rows contain an uppercase character, ${internalWs.length} rows contain whitespace ` +
          `inside the value, ${plusAddr.length} rows use plus-addressing. ${emailFailures.length} distinct values ` +
          `fail the syntax check \`${SYNTAX.source}\`.`,
        `Exact duplicates: ${emailExact.groups} groups over ${emailExact.rows} rows. Case-insensitive ` +
          `duplicates: ${emailFolded.groups} groups over ${emailFolded.rows} rows. ${domains.size} distinct ` +
          `domains. ${localMulti.length} local-parts appear on more than one domain.`,
      ],
      tables: [
        table(
          domains.size <= 15 ? `Complete domain inventory (${domains.size} distinct)` : `Top 15 domains of ${domains.size}`,
          ['domain', 'rows'],
          domains.entries().slice(0, 15).map((e) => [code(e.value), String(e.count)]),
        ),
        table(
          `Values failing the syntax check${emailFailures.length > 30 ? ` (first 30 of ${emailFailures.length})` : ''}`,
          ['raw value', 'rows'],
          emailFailures.slice(0, 30).map((v) => [code(v), String(p.email.filter((x) => x === v).length)]),
        ),
        duplicateTable(emailFolded, 'Duplicate emails after case folding'),
        table(
          `Local-parts on more than one domain${localMulti.length > 8 ? ` (first 8 of ${localMulti.length})` : ''}`,
          ['local-part', 'domains'],
          localMulti
            .sort((a, b) => b[1].size - a[1].size || (a[0] < b[0] ? -1 : 1))
            .slice(0, 8)
            .map(([l, d]) => [code(l), [...d].sort().map((x) => code(x)).join(' ')]),
        ),
      ],
      json: {
        rowsWithUppercase: hasUpper.length,
        rowsWithInternalWhitespace: internalWs.length,
        plusAddressingRows: plusAddr.length,
        syntaxFailures: emailFailures.map((v) => ({raw: v, rows: p.email.filter((x) => x === v).length})),
        domains: domains.entries().map((e) => ({domain: e.value, rows: e.count})),
        exactDuplicateGroups: emailExact.groups,
        exactDuplicateRows: emailExact.rows,
        foldedDuplicateGroups: emailFolded.groups,
        foldedDuplicateRows: emailFolded.rows,
        localPartsOnSeveralDomains: localMulti.map(([l, d]) => ({localPart: l, domains: [...d].sort()})),
      },
    }),
  );

  // ---- dob ----------------------------------------------------------------------
  const dobA = dateAnalysis(p.dob);
  const dobFuture = p.dobCandidates.filter((c) => c.length > 0 && (c[c.length - 1] as string) > ctx.asOf);
  const dobAllFuture = p.dobCandidates.filter((c) => c.length > 0 && (c[0] as string) > ctx.asOf);
  const ages: number[] = [];
  let ageUnder18 = 0;
  let ageOver100 = 0;
  let sameAsSignup = 0;
  let sameDateAsSignup = 0;
  p.dob.forEach((raw, i) => {
    if (raw !== '' && raw === p.signupDate[i]) sameAsSignup++;
    const dc = p.dobCandidates[i] ?? [];
    const sc = p.signupCandidates[i] ?? [];
    if (dc.length > 0 && sc.length > 0 && dc.some((d) => sc.includes(d))) sameDateAsSignup++;
    if (dc.length === 0 || sc.length === 0) return;
    const years = (Date.parse(`${sc[0] as string}T00:00:00Z`) - Date.parse(`${dc[0] as string}T00:00:00Z`)) / (365.25 * 86_400_000);
    ages.push(years);
    if (years < 18) ageUnder18++;
    if (years > 100) ageOver100++;
  });
  sections.push(
    columnSection({
      file: FILE,
      column: 'dob',
      values: p.dob,
      notes: [
        ...dobA.notes,
        `Shapes proven mixed (they carry both an unambiguous day-first and an unambiguous month-first value): ` +
          `${dobA.mixedShapes.length === 0 ? 'none' : dobA.mixedShapes.map((s) => code(s)).join(', ')}.`,
        `Implausible values, measured against the reference date ${ctx.asOf} and against signup_date, using ` +
          `the earliest candidate date of each value: ` +
          `${dobFuture.length} rows are in the future under some ordering, ${dobAllFuture.length} under every ` +
          `ordering, ${ageUnder18} rows give an age at signup below 18, ${ageOver100} above 100, ` +
          `${sameAsSignup} rows have dob byte-identical to signup_date and ${sameDateAsSignup} rows have a dob ` +
          `candidate date equal to a signup_date candidate date. Age at signup over ` +
          `${numStats(ages).n} comparable rows: min ${fmtNum(numStats(ages).min)}, p5 ${fmtNum(numStats(ages).p5)}, ` +
          `median ${fmtNum(numStats(ages).median)}, p95 ${fmtNum(numStats(ages).p95)}, max ${fmtNum(numStats(ages).max)}.`,
      ],
      tables: [
        ...dobA.tables,
        shapeCrossTab('Shape x source', dobA.facts.map((f) => f.shape), p.source, 'source'),
        shapeCrossTab(
          'Shape x signup year (year taken from signup_date)',
          dobA.facts.map((f) => f.shape),
          p.signupDate.map((v) => (candidateDates(v)[0] ?? '').slice(0, 4)),
          'signup year',
        ),
      ],
      json: {
        ...dobA.json,
        futureUnderSomeOrdering: dobFuture.length,
        futureUnderEveryOrdering: dobAllFuture.length,
        ageAtSignupUnder18: ageUnder18,
        ageAtSignupOver100: ageOver100,
        dobIdenticalToSignupDateRaw: sameAsSignup,
        dobCandidateEqualsSignupCandidate: sameDateAsSignup,
        ageAtSignup: numStats(ages),
      },
    }),
  );

  // ---- sex ----------------------------------------------------------------------
  const sexMerge = foldingMerge(p.sex);
  sections.push(
    columnSection({
      file: FILE,
      column: 'sex',
      values: p.sex,
      notes: [`Folding merges ${sexMerge.groups} groups of raw spellings, covering ${sexMerge.rows} rows.`],
      tables: [sexMerge.table],
      json: {foldingMergeGroups: sexMerge.groups, foldingMergeRows: sexMerge.rows, foldingMerges: sexMerge.json},
    }),
  );

  // ---- bsn ----------------------------------------------------------------------
  const bsnNonEmpty = p.bsn.filter((v) => v !== '');
  const nonDigit = [...new Set(bsnNonEmpty.filter((v) => !/^\d+$/u.test(v)))].sort();
  const nine = bsnNonEmpty.filter((v) => /^\d{9}$/u.test(v));
  const ninePass = nine.filter((v) => elfproef(v));
  const eight = bsnNonEmpty.filter((v) => /^\d{8}$/u.test(v));
  const eightPadPass = eight.filter((v) => elfproef(`0${v}`));
  const leadingZero = bsnNonEmpty.filter((v) => v.startsWith('0'));
  const bsnDup = duplicateStats(p.bsn);
  sections.push(
    columnSection({
      file: FILE,
      column: 'bsn',
      values: p.bsn,
      notes: [
        `${p.bsn.length - bsnNonEmpty.length} rows are empty. ${nonDigit.length} distinct non-empty values ` +
          `contain a non-digit character. ${leadingZero.length} non-empty values start with a zero.`,
        `Elfproef (weights ${ELFPROEF_WEIGHTS.join(', ')}, sum mod 11 == 0): of ${nine.length} nine-digit values ` +
          `${ninePass.length} pass and ${nine.length - ninePass.length} fail. ${eight.length} values have eight ` +
          `digits; padded with a leading zero, ${eightPadPass.length} of those pass the elfproef.`,
        `${bsnDup.groups} bsn values are carried by more than one row (${bsnDup.rows} rows involved).`,
      ],
      tables: [
        lengthTable(bsnNonEmpty),
        crossTab(
          'bsn presence x signup year (year from the earliest candidate reading of signup_date)',
          'bsn',
          p.bsn.map((v, i) => [v === '' ? 'empty' : 'non-empty', (p.signupCandidates[i] ?? [])[0]?.slice(0, 4) ?? '(unparsed)'] as const),
        ),
        duplicateTable(bsnDup, 'Duplicate bsn values'),
        table('Non-digit values', ['raw value', 'rows'], nonDigit.slice(0, 30).map((v) => [code(v), String(p.bsn.filter((x) => x === v).length)])),
      ],
      json: {
        nonEmpty: bsnNonEmpty.length,
        nonDigitValues: nonDigit,
        nineDigit: nine.length,
        nineDigitElfproefPass: ninePass.length,
        nineDigitElfproefFail: nine.length - ninePass.length,
        eightDigit: eight.length,
        eightDigitElfproefPassWhenPadded: eightPadPass.length,
        leadingZero: leadingZero.length,
        duplicateGroups: bsnDup.groups,
        duplicateRows: bsnDup.rows,
      },
    }),
  );

  // ---- phone --------------------------------------------------------------------
  const phoneDigits = p.phone.map((v) => digitsOnly(v));
  const digitCount = new Counter();
  for (const d of phoneDigits) digitCount.add(String(d.length));
  // Prefix classes rather than raw prefixes: the raw first four characters produce one row
  // per mobile block, which says nothing the shape inventory has not already said.
  const phonePrefix = new Counter();
  for (const v of p.phone) {
    const t = v.trim();
    phonePrefix.add(
      t === ''
        ? '(empty)'
        : t.startsWith('+31')
          ? '+31'
          : t.startsWith('0031')
            ? '0031'
            : t.startsWith('06')
              ? '06'
              : t.startsWith('0')
                ? '0, not 06'
                : t.startsWith('+')
                  ? '+, not +31'
                  : 'other',
    );
  }
  const nonNl = [...new Set(p.phone.filter((v) => v !== '' && !/^(\+31|0031|0)/u.test(v.trim())))].sort();
  const phoneDup = duplicateStats(phoneDigits);
  sections.push(
    columnSection({
      file: FILE,
      column: 'phone',
      values: p.phone,
      notes: [
        `Compared on digits only, ${phoneDup.groups} numbers are carried by more than one row ` +
          `(${phoneDup.rows} rows involved). ${nonNl.length} distinct non-empty values do not start with ` +
          `\`+31\`, \`0031\` or \`0\`.`,
      ],
      tables: [
        table(
          'Digit-count distribution (non-digit characters removed)',
          ['digits', 'rows'],
          digitCount
            .entries()
            .sort((a, b) => Number(a.value) - Number(b.value))
            .map((e) => [e.value, String(e.count)]),
        ),
        table(
          'Prefix class inventory',
          ['prefix class', 'rows'],
          phonePrefix.entries().map((e) => [code(e.value), String(e.count)]),
        ),
        table(
          `Values not starting with +31, 0031 or 0${nonNl.length > 30 ? ` (first 30 of ${nonNl.length})` : ''}`,
          ['raw value', 'rows'],
          nonNl.slice(0, 30).map((v) => [code(v), String(p.phone.filter((x) => x === v).length)]),
        ),
        duplicateTable(phoneDup, 'Duplicate phone numbers (digits-only comparison)'),
      ],
      json: {
        digitCounts: digitCount.entries().map((e) => ({digits: Number(e.value), rows: e.count})),
        prefixClasses: phonePrefix.entries().map((e) => ({prefixClass: e.value, rows: e.count})),
        nonDutchPrefixValues: nonNl,
        duplicateGroups: phoneDup.groups,
        duplicateRows: phoneDup.rows,
      },
    }),
  );

  // ---- city ---------------------------------------------------------------------
  const cityMerge = foldingMerge(p.city);
  sections.push(
    columnSection({
      file: FILE,
      column: 'city',
      values: p.city,
      notes: [
        `${new Set(p.city.map((v) => fold(v))).size} distinct folded values. Folding merges ${cityMerge.groups} ` +
          `groups of raw spellings, covering ${cityMerge.rows} rows.`,
      ],
      tables: [cityMerge.table],
      json: {foldingMergeGroups: cityMerge.groups, foldingMergeRows: cityMerge.rows, foldingMerges: cityMerge.json},
    }),
  );

  // ---- weight and weight_unit ---------------------------------------------------
  const weightNum = numericAnalysis(p.weight, WEIGHT_BAND_EDGES, 'weight');
  const unitStatsRows: string[][] = [];
  const perUnit = new Map<string, number[]>();
  const heavyLight = new Counter();
  p.weight.forEach((raw, i) => {
    const parsed = parseNumber(raw);
    const unit = p.weightUnit[i] ?? '';
    if (!parsed.ok) return;
    const list = perUnit.get(unit);
    if (list === undefined) perUnit.set(unit, [parsed.value]);
    else list.push(parsed.value);
    if (parsed.value > 200) heavyLight.add(`${unit === '' ? '(empty unit)' : unit} > 200`);
    if (parsed.value < 35) heavyLight.add(`${unit === '' ? '(empty unit)' : unit} < 35`);
  });
  for (const [unit, list] of [...perUnit.entries()].sort((a, b) => b[1].length - a[1].length)) {
    unitStatsRows.push(statsRow(unit === '' ? '(empty unit)' : `\`${unit}\``, numStats(list)));
  }
  // BMI cross-check: which unit assumption puts the row inside a plausible BMI window.
  let kgOutLbIn = 0;
  let lbOutKgIn = 0;
  p.weight.forEach((raw, i) => {
    const w = parseNumber(raw);
    const h = parseNumber(p.heightCm[i] ?? '');
    if (!w.ok || !h.ok || h.value <= 0) return;
    const bmiKg = bmi(w.value, h.value);
    const bmiLb = bmi(w.value / 2.20462, h.value);
    if (!bmiInWindow(bmiKg) && bmiInWindow(bmiLb)) kgOutLbIn++;
    if (!bmiInWindow(bmiLb) && bmiInWindow(bmiKg)) lbOutKgIn++;
  });
  sections.push(
    columnSection({
      file: FILE,
      column: 'weight',
      values: p.weight,
      forceShapeTable: true,
      notes: [
        ...weightNum.notes,
        `BMI cross-check with height_cm read as centimetres and a ${BMI_WINDOW.min}..${BMI_WINDOW.max} BMI window: ${kgOutLbIn} rows sit ` +
          `outside the window under the kilogram reading but inside it under the pound reading ` +
          `(weight / 2.20462); ${lbOutKgIn} rows are the reverse.`,
      ],
      tables: [
        ...weightNum.tables,
        table('Numeric distribution per weight_unit value', [...STATS_HEADER], unitStatsRows),
        table(
          'Extreme values per weight_unit value',
          ['weight_unit x threshold', 'rows'],
          heavyLight.entries().map((e) => [plain(e.value === '' ? '(empty)' : e.value), String(e.count)]),
        ),
      ],
      json: {
        ...weightNum.json,
        perUnit: [...perUnit.entries()].map(([unit, list]) => ({unit, stats: numStats(list)})),
        extremes: heavyLight.entries().map((e) => ({key: e.value, rows: e.count})),
        bmiKgOutsideLbInside: kgOutLbIn,
        bmiLbOutsideKgInside: lbOutKgIn,
      },
    }),
  );

  const unitMerge = foldingMerge(p.weightUnit);
  sections.push(
    columnSection({
      file: FILE,
      column: 'weight_unit',
      values: p.weightUnit,
      notes: [
        `${p.weightUnit.filter((v) => v === '').length} rows have no unit; of those, ` +
          `${p.weightUnit.filter((v, i) => v === '' && (p.weight[i] ?? '') !== '').length} still carry a weight.`,
        `Folding merges ${unitMerge.groups} groups of raw spellings, covering ${unitMerge.rows} rows.`,
      ],
      tables: [unitMerge.table],
      json: {foldingMerges: unitMerge.json},
    }),
  );

  // ---- height_cm ----------------------------------------------------------------
  const heightNum = numericAnalysis(p.heightCm, HEIGHT_BAND_EDGES, 'height_cm');
  sections.push(
    columnSection({
      file: FILE,
      column: 'height_cm',
      values: p.heightCm,
      forceShapeTable: true,
      notes: [
        ...heightNum.notes,
        `Bands are the ones a reader would ask about: below 3 (a value in metres), 3..100, 100..140, 140..220 ` +
          `and 220 or more. Band labels below follow ${bandLabels(HEIGHT_BAND_EDGES).join(', ')}.`,
      ],
      tables: heightNum.tables,
      json: heightNum.json,
    }),
  );

  // ---- status -------------------------------------------------------------------
  const statusMerge = foldingMerge(p.status);
  sections.push(
    columnSection({
      file: FILE,
      column: 'status',
      values: p.status,
      notes: [
        `${new Set(p.status.map((v) => fold(v))).size} distinct folded values. Folding merges ` +
          `${statusMerge.groups} groups of raw spellings, covering ${statusMerge.rows} rows.`,
      ],
      tables: [statusMerge.table],
      json: {foldingMergeGroups: statusMerge.groups, foldingMergeRows: statusMerge.rows, foldingMerges: statusMerge.json},
    }),
  );

  // ---- signup_date --------------------------------------------------------------
  const suA = dateAnalysis(p.signupDate);
  const suFuture = p.signupCandidates.filter((c) => c.length > 0 && (c[c.length - 1] as string) > ctx.asOf);
  const suAllFuture = p.signupCandidates.filter((c) => c.length > 0 && (c[0] as string) > ctx.asOf);
  const suFirst = p.signupCandidates.flatMap((c) => (c.length > 0 ? [c[0] as string] : []));
  const suLast = p.signupCandidates.flatMap((c) => (c.length > 0 ? [c[c.length - 1] as string] : []));
  sections.push(
    columnSection({
      file: FILE,
      column: 'signup_date',
      values: p.signupDate,
      notes: [
        ...suA.notes,
        `Shapes proven mixed: ${suA.mixedShapes.length === 0 ? 'none' : suA.mixedShapes.map((s) => code(s)).join(', ')}.`,
        `Range under the earliest candidate reading: ${suFirst.sort()[0] ?? '-'} to ` +
          `${suLast.sort()[suLast.length - 1] ?? '-'}. Measured against ${ctx.asOf}, ${suFuture.length} rows are in ` +
          `the future under some ordering and ${suAllFuture.length} under every ordering.`,
      ],
      tables: [
        ...suA.tables,
        shapeCrossTab('Shape x source', suA.facts.map((f) => f.shape), p.source, 'source'),
        shapeCrossTab('Shape x year (year of the value itself)', suA.facts.map((f) => f.shape), suA.facts.map((f) => f.year), 'year'),
      ],
      json: {
        ...suA.json,
        futureUnderSomeOrdering: suFuture.length,
        futureUnderEveryOrdering: suAllFuture.length,
        earliest: suFirst[0] ?? null,
        latest: suLast[suLast.length - 1] ?? null,
      },
    }),
  );

  // ---- source -------------------------------------------------------------------
  sections.push(
    columnSection({
      file: FILE,
      column: 'source',
      values: p.source,
      notes: [
        `EXPORT-NOTES.md names \`typeform\`, \`website\`, campaign tags and \`import\`; the values actually ` +
          `present are listed below.`,
      ],
      json: {},
    }),
  );

  // ---- whole row ----------------------------------------------------------------
  const lineCounter = new Counter();
  for (const l of p.csv.info.lines.slice(1)) lineCounter.add(l);
  const dupLines = lineCounter.entries().filter((e) => e.count > 1);
  sections.push({
    key: `${FILE}.whole-row`,
    title: `${FILE} whole-row structure`,
    group: 'inventory',
    notes: [
      `The header has ${p.csv.header.length} fields. ${p.csv.raggedRows.length} data rows have a different ` +
        `field count. ${p.csv.fieldsWithNewline} fields contain a line break. ${dupLines.length} physical data ` +
        `lines are byte-identical to another line (${dupLines.reduce((t, e) => t + e.count, 0)} lines involved).` +
        (p.csv.relaxedQuotes ? ' The strict quote reader rejected the file, so relax_quotes was used.' : ''),
    ],
    tables: [
      table(
        'Field count per data row',
        ['fields', 'rows'],
        p.csv.fieldCounts
          .entries()
          .sort((a, b) => Number(a.value) - Number(b.value))
          .map((e) => [e.value, String(e.count)]),
      ),
    ],
    json: {
      headerFields: p.csv.header.length,
      fieldCounts: p.csv.fieldCounts.entries().map((e) => ({fields: Number(e.value), rows: e.count})),
      raggedRows: p.csv.raggedRows.length,
      fieldsWithNewline: p.csv.fieldsWithNewline,
      duplicatePhysicalLines: dupLines.length,
      duplicatePhysicalLineRows: dupLines.reduce((t, e) => t + e.count, 0),
      relaxedQuotes: p.csv.relaxedQuotes,
    },
  });

  return sections;
}
