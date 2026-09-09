/**
 * Inventories for `legacy_export/intakes.csv`, including the joins back to
 * `patients.csv` (resolution, self-reported weight and height against the patient row).
 */
import {column, type Csv} from './csv.js';
import {candidateDates} from './dates.js';
import {
  HEIGHT_BAND_EDGES,
  RATIO_EDGES,
  WEIGHT_BAND_EDGES,
  dateAnalysis,
  foldingMerge,
  freeTextAnalysis,
  numericAnalysis,
  shapeCrossTab,
  type TermSpec,
} from './common.js';
import {code, columnSection, crossTab, table, type Section, type Table} from './report.js';
import type {Patients} from './patients.js';
import {Counter, KEY_SEP, band, bandLabels, fold, numStats, parseNumber} from './util.js';

const FILE = 'intakes.csv';

export interface Intakes {
  readonly csv: Csv;
  readonly intakeId: readonly string[];
  readonly patientId: readonly string[];
  readonly submittedAt: readonly string[];
  readonly version: readonly string[];
  readonly weight: readonly string[];
  readonly height: readonly string[];
  readonly meds: readonly string[];
  readonly conditions: readonly string[];
  readonly alcohol: readonly string[];
  readonly outcome: readonly string[];
  readonly reviewerNote: readonly string[];
  readonly submittedCandidates: ReadonlyArray<readonly string[]>;
}

export function loadIntakes(csv: Csv): Intakes {
  const submittedAt = column(csv, 'submitted_at');
  return {
    csv,
    intakeId: column(csv, 'intake_id'),
    patientId: column(csv, 'legacy_patient_id'),
    submittedAt,
    version: column(csv, 'questionnaire_version'),
    weight: column(csv, 'weight'),
    height: column(csv, 'height'),
    meds: column(csv, 'meds_current'),
    conditions: column(csv, 'conditions'),
    alcohol: column(csv, 'alcohol_units_week'),
    outcome: column(csv, 'outcome'),
    reviewerNote: column(csv, 'reviewer_note'),
    submittedCandidates: submittedAt.map((v) => candidateDates(v)),
  };
}

const MED_TERMS: readonly TermSpec[] = [
  {label: 'semaglutide', patterns: ['semaglutide']},
  {label: 'ozempic', patterns: ['ozempic']},
  {label: 'wegovy', patterns: ['wegovy']},
  {label: 'rybelsus', patterns: ['rybelsus']},
  {label: 'liraglutide', patterns: ['liraglutide']},
  {label: 'saxenda', patterns: ['saxenda']},
  {label: 'victoza', patterns: ['victoza']},
  {label: 'tirzepatide', patterns: ['tirzepatide']},
  {label: 'mounjaro', patterns: ['mounjaro']},
  {label: 'zepbound', patterns: ['zepbound']},
  {label: 'dulaglutide', patterns: ['dulaglutide']},
  {label: 'trulicity', patterns: ['trulicity']},
  {label: 'exenatide', patterns: ['exenatide']},
  {label: 'byetta', patterns: ['byetta']},
  {label: 'bydureon', patterns: ['bydureon']},
  {label: 'lixisenatide', patterns: ['lixisenatide']},
  {label: 'metformin / metformine', patterns: ['metformin']},
];

const CONDITION_TERMS: readonly TermSpec[] = [
  {label: 'thyroid', patterns: ['thyroid']},
  {label: 'schildklier', patterns: ['schildklier']},
  {label: 'pancrea', patterns: ['pancrea']},
  {label: 'alvleesklier', patterns: ['alvleesklier']},
  {label: 'diabetes', patterns: ['diabetes']},
  {label: 'suikerziekte', patterns: ['suikerziekte']},
  {label: 'hypertens', patterns: ['hypertens']},
  {label: 'hoge bloeddruk', patterns: ['hoge bloeddruk']},
  {label: 'bloeddruk', patterns: ['bloeddruk']},
  {label: 'apnea / apnoe / slaapapneu', patterns: ['apnea', 'apnoe', 'slaapapneu']},
  {label: 'cholesterol', patterns: ['cholesterol']},
  {label: 'pcos', patterns: ['pcos']},
  {label: 'lever / nafld', patterns: ['lever', 'nafld']},
  {label: 'reflux', patterns: ['reflux']},
  {label: 'artrose / osteoarth', patterns: ['artrose', 'osteoarth']},
  {label: 'depress', patterns: ['depress']},
];

/** Intake value against the patient-row value, as a ratio, banded by RATIO_EDGES. */
function ratioTable(
  caption: string,
  intakeValues: readonly string[],
  patientValues: readonly string[],
  rowPatientIndex: ReadonlyArray<number | null>,
): {table: Table; json: Array<Record<string, unknown>>; comparable: number} {
  const c = new Counter();
  const ratios: number[] = [];
  intakeValues.forEach((raw, i) => {
    const pi = rowPatientIndex[i];
    if (pi === null || pi === undefined) return;
    const a = parseNumber(raw);
    const b = parseNumber(patientValues[pi] ?? '');
    if (!a.ok || !b.ok || b.value === 0) return;
    const r = a.value / b.value;
    ratios.push(r);
    c.add(band(r, RATIO_EDGES));
  });
  const labels = bandLabels(RATIO_EDGES);
  return {
    table: table(caption, ['ratio band', 'rows'], labels.map((l) => [l, String(c.get(l))])),
    json: labels.map((l) => ({band: l, rows: c.get(l)})),
    comparable: ratios.length,
  };
}

export interface IntakesContext {
  /** Reference date (`--as-of`): a value after it is "future". */
  readonly asOf: string;
  readonly patients: Patients;
  /** patient_legacy_id values seen in consents.jsonl, for the orphan cross-check. */
  readonly consentPatientIds: ReadonlySet<string>;
}

export function intakesSections(it: Intakes, ctx: IntakesContext): Section[] {
  const sections: Section[] = [];
  const p = ctx.patients;

  /** Row -> patients.csv row index, or null when the id does not resolve. */
  const patientIndex: Array<number | null> = it.patientId.map((id) => {
    const rows = p.byLegacyId.get(id);
    return rows === undefined ? null : (rows[0] as number);
  });

  // ---- intake_id ----------------------------------------------------------------
  const idCounter = new Counter();
  for (const v of it.intakeId) idCounter.add(v);
  const idDups = idCounter.entries().filter((e) => e.count > 1);
  sections.push(
    columnSection({
      file: FILE,
      column: 'intake_id',
      values: it.intakeId,
      notes: [
        `${idCounter.size} distinct ids over ${it.csv.rows.length} rows; ${idDups.length} id values are carried ` +
          `by more than one row (${idDups.reduce((t, e) => t + e.count, 0)} rows involved).`,
      ],
      tables: [
        table(
          'Duplicate intake_id values',
          ['value', 'rows'],
          idDups.slice(0, 30).map((e) => [code(e.value), String(e.count)]),
        ),
      ],
      json: {duplicateGroups: idDups.length, duplicateRows: idDups.reduce((t, e) => t + e.count, 0)},
    }),
  );

  // ---- legacy_patient_id --------------------------------------------------------
  const resolved = patientIndex.filter((x) => x !== null).length;
  const orphanRows = it.patientId.filter((_, i) => patientIndex[i] === null);
  const orphanIds = [...new Set(orphanRows)].sort();
  const orphanInConsents = orphanIds.filter((id) => ctx.consentPatientIds.has(id));
  const orphanPairs: Array<readonly [string, string]> = [];
  it.patientId.forEach((_, i) => {
    if (patientIndex[i] !== null) return;
    const year = (it.submittedCandidates[i] ?? [])[0]?.slice(0, 4) ?? '(unparsed)';
    orphanPairs.push([year, it.version[i] ?? '']);
  });
  const intakesPerPatient = new Counter();
  for (const id of it.patientId) intakesPerPatient.add(id);
  sections.push(
    columnSection({
      file: FILE,
      column: 'legacy_patient_id',
      values: it.patientId,
      notes: [
        `${resolved} rows resolve to a patients.csv legacy_id, ${orphanRows.length} rows do not. The ` +
          `unresolved rows carry ${orphanIds.length} distinct ids, of which ${orphanInConsents.length} also ` +
          `appear in consents.jsonl.`,
        `${intakesPerPatient.size} distinct patient ids appear in this column; ` +
          `${p.byLegacyId.size - [...p.byLegacyId.keys()].filter((k) => intakesPerPatient.get(k) > 0).length} ` +
          `patients.csv ids have no intake.`,
      ],
      tables: [
        crossTab('Unresolved (orphan) intakes: submitted year x questionnaire_version', 'submitted year', orphanPairs),
        table(
          `Orphan ids also present in consents.jsonl${orphanInConsents.length > 20 ? ` (first 20 of ${orphanInConsents.length})` : ''}`,
          ['legacy_patient_id', 'intake rows'],
          orphanInConsents.slice(0, 20).map((id) => [code(id), String(orphanRows.filter((x) => x === id).length)]),
        ),
      ],
      json: {
        resolvedRows: resolved,
        orphanRows: orphanRows.length,
        orphanDistinctIds: orphanIds.length,
        orphanIdsInConsents: orphanInConsents,
        orphanIds,
      },
    }),
  );

  // ---- submitted_at -------------------------------------------------------------
  const saA = dateAnalysis(it.submittedAt);
  const saFuture = it.submittedCandidates.filter((c) => c.length > 0 && (c[c.length - 1] as string) > ctx.asOf);
  const saAllFuture = it.submittedCandidates.filter((c) => c.length > 0 && (c[0] as string) > ctx.asOf);
  let everBefore = 0;
  let alwaysBefore = 0;
  const gapBand = new Counter();
  const gaps: number[] = [];
  it.submittedCandidates.forEach((sc, i) => {
    const pi = patientIndex[i];
    if (pi === null || pi === undefined || sc.length === 0) return;
    const gc = p.signupCandidates[pi] ?? [];
    if (gc.length === 0) return;
    const combos: number[] = [];
    for (const s of sc) {
      for (const g of gc) {
        combos.push(Math.round((Date.parse(`${s}T00:00:00Z`) - Date.parse(`${g}T00:00:00Z`)) / 86_400_000));
      }
    }
    if (combos.some((x) => x < 0)) everBefore++;
    if (combos.every((x) => x < 0)) alwaysBefore++;
    // Reported gap: earliest candidate of each date, so the figure is reproducible.
    const gap = Math.round(
      (Date.parse(`${sc[0] as string}T00:00:00Z`) - Date.parse(`${gc[0] as string}T00:00:00Z`)) / 86_400_000,
    );
    if (gap < 0) {
      gaps.push(gap);
      gapBand.add(band(gap, [-365, -180, -90, -30, -7, 0]));
    }
  });
  sections.push(
    columnSection({
      file: FILE,
      column: 'submitted_at',
      values: it.submittedAt,
      notes: [
        ...saA.notes,
        `Shapes proven mixed: ${saA.mixedShapes.length === 0 ? 'none' : saA.mixedShapes.map((s) => code(s)).join(', ')}.`,
        `Measured against ${ctx.asOf}: ${saFuture.length} rows are in the future under some ordering, ` +
          `${saAllFuture.length} under every ordering.`,
        `Against the patient row's signup_date (resolvable rows only): ${everBefore} intakes are earlier than ` +
          `signup under at least one combination of orderings and ${alwaysBefore} are earlier under every ` +
          `combination. The gap table uses the earliest candidate of each date; over ${gaps.length} negative ` +
          `gaps the median is ${numStats(gaps).median ?? '-'} days and the extreme is ${numStats(gaps).min ?? '-'} days.`,
      ],
      tables: [
        ...saA.tables,
        shapeCrossTab('Shape x year (year of the value itself)', saA.facts.map((f) => f.shape), saA.facts.map((f) => f.year), 'year'),
        shapeCrossTab('Shape x questionnaire_version', saA.facts.map((f) => f.shape), it.version, 'questionnaire_version'),
        table(
          'Gap in days between submitted_at and the patient row signup_date, negative gaps only',
          ['gap band (days)', 'rows'],
          bandLabels([-365, -180, -90, -30, -7, 0]).map((l) => [l, String(gapBand.get(l))]),
        ),
      ],
      json: {
        ...saA.json,
        futureUnderSomeOrdering: saFuture.length,
        futureUnderEveryOrdering: saAllFuture.length,
        beforeSignupUnderSomeOrdering: everBefore,
        beforeSignupUnderEveryOrdering: alwaysBefore,
        negativeGapStats: numStats(gaps),
        negativeGapBands: bandLabels([-365, -180, -90, -30, -7, 0]).map((l) => ({band: l, rows: gapBand.get(l)})),
      },
    }),
  );

  // ---- questionnaire_version ----------------------------------------------------
  const verMerge = foldingMerge(it.version);
  sections.push(
    columnSection({
      file: FILE,
      column: 'questionnaire_version',
      values: it.version,
      notes: [`Folding merges ${verMerge.groups} groups of raw spellings, covering ${verMerge.rows} rows.`],
      tables: [verMerge.table],
      json: {foldingMerges: verMerge.json},
    }),
  );

  // ---- weight -------------------------------------------------------------------
  const wNum = numericAnalysis(it.weight, WEIGHT_BAND_EDGES, 'weight');
  const wRatio = ratioTable('intakes.weight / patients.weight', it.weight, p.weight, patientIndex);
  sections.push(
    columnSection({
      file: FILE,
      column: 'weight',
      values: it.weight,
      forceShapeTable: true,
      notes: [
        ...wNum.notes,
        `${wRatio.comparable} rows have a resolvable patient row and a numeric weight on both sides. The ` +
          `0.4..0.5 and 2 .. 2.4 bands bracket the kilogram/pound factor 2.20462.`,
      ],
      tables: [...wNum.tables, wRatio.table],
      json: {...wNum.json, comparableRows: wRatio.comparable, ratioBands: wRatio.json},
    }),
  );

  // ---- height -------------------------------------------------------------------
  const hNum = numericAnalysis(it.height, HEIGHT_BAND_EDGES, 'height');
  const hRatio = ratioTable('intakes.height / patients.height_cm', it.height, p.heightCm, patientIndex);
  sections.push(
    columnSection({
      file: FILE,
      column: 'height',
      values: it.height,
      forceShapeTable: true,
      notes: [...hNum.notes, `${hRatio.comparable} rows have a resolvable patient row and a numeric height on both sides.`],
      tables: [...hNum.tables, hRatio.table],
      json: {...hNum.json, comparableRows: hRatio.comparable, ratioBands: hRatio.json},
    }),
  );

  // ---- meds_current -------------------------------------------------------------
  const meds = freeTextAnalysis(it.meds, MED_TERMS, ['glut', 'ozem', 'sema', 'tide']);
  sections.push(
    columnSection({
      file: FILE,
      column: 'meds_current',
      values: it.meds,
      notes: meds.notes,
      tables: meds.tables,
      json: meds.json,
    }),
  );

  // ---- conditions ---------------------------------------------------------------
  const conds = freeTextAnalysis(it.conditions, CONDITION_TERMS, ['diabet', 'apne', 'thyro', 'schildk', 'bloeddr']);
  sections.push(
    columnSection({
      file: FILE,
      column: 'conditions',
      values: it.conditions,
      notes: conds.notes,
      tables: conds.tables,
      json: conds.json,
    }),
  );

  // ---- alcohol_units_week -------------------------------------------------------
  const alc = numericAnalysis(it.alcohol, [1, 8, 15, 22, 50], 'alcohol_units_week');
  sections.push(
    columnSection({
      file: FILE,
      column: 'alcohol_units_week',
      values: it.alcohol,
      notes: alc.notes,
      tables: alc.tables,
      json: alc.json,
    }),
  );

  // ---- outcome ------------------------------------------------------------------
  const outMerge = foldingMerge(it.outcome);
  sections.push(
    columnSection({
      file: FILE,
      column: 'outcome',
      values: it.outcome,
      notes: [
        `${new Set(it.outcome.map((v) => fold(v))).size} distinct folded values. Folding merges ` +
          `${outMerge.groups} groups of raw spellings, covering ${outMerge.rows} rows.`,
      ],
      tables: [outMerge.table],
      json: {foldingMergeGroups: outMerge.groups, foldingMerges: outMerge.json},
    }),
  );

  // ---- reviewer_note ------------------------------------------------------------
  const notePairs: Array<readonly [string, string]> = it.reviewerNote.map((v, i) => [fold(v), fold(it.outcome[i] ?? '')] as const);
  const notesOnEmptyOutcome = it.reviewerNote.filter((v, i) => v !== '' && (it.outcome[i] ?? '') === '').length;
  sections.push(
    columnSection({
      file: FILE,
      column: 'reviewer_note',
      values: it.reviewerNote,
      notes: [
        `${notesOnEmptyOutcome} rows carry a non-empty reviewer_note while outcome is empty. The cross-tab ` +
          `below shows which note text sits with which outcome; both are folded.`,
      ],
      tables: [crossTab('Folded reviewer_note x folded outcome', 'folded reviewer_note', notePairs)],
      json: {
        notesOnEmptyOutcome,
        noteByOutcome: (() => {
          const c = new Counter();
          for (const [a, b] of notePairs) c.add(`${a}||${b}`);
          return c.entries().map((e) => {
            const [note, outcome] = e.value.split('||') as [string, string];
            return {note, outcome, rows: e.count};
          });
        })(),
      },
    }),
  );

  // ---- duplicates ---------------------------------------------------------------
  const pairCounter = new Counter();
  it.patientId.forEach((id, i) => pairCounter.add(`${id}||${it.submittedAt[i] ?? ''}`));
  const dupPairs = pairCounter.entries().filter((e) => e.count > 1);
  const perPatient = new Counter();
  for (const id of it.patientId) perPatient.add(id);
  const perPatientDist = new Counter();
  for (const k of perPatient.keys()) perPatientDist.add(String(perPatient.get(k)));
  const withoutIdCounter = new Counter();
  const idIdx = it.csv.header.indexOf('intake_id');
  for (const r of it.csv.rows) withoutIdCounter.add(r.filter((_, i) => i !== idIdx).join(KEY_SEP));
  const identicalApartFromId = withoutIdCounter.entries().filter((e) => e.count > 1);
  sections.push({
    key: `${FILE}.duplicates`,
    title: `${FILE} duplicate rows and intakes per patient`,
    group: 'inventory',
    notes: [
      `${dupPairs.length} (legacy_patient_id, submitted_at) pairs appear more than once, covering ` +
        `${dupPairs.reduce((t, e) => t + e.count, 0)} rows. ${identicalApartFromId.length} groups of rows are ` +
        `byte-identical in every field except intake_id, covering ` +
        `${identicalApartFromId.reduce((t, e) => t + e.count, 0)} rows.`,
    ],
    tables: [
      table(
        'Intakes per patient id',
        ['intakes', 'patient ids'],
        perPatientDist
          .entries()
          .sort((a, b) => Number(a.value) - Number(b.value))
          .map((e) => [e.value, String(e.count)]),
      ),
      table(
        `Repeated (legacy_patient_id, submitted_at) pairs${dupPairs.length > 20 ? ` (first 20 of ${dupPairs.length})` : ''}`,
        ['legacy_patient_id', 'submitted_at', 'rows'],
        dupPairs.slice(0, 20).map((e) => {
          const [id, at] = e.value.split('||') as [string, string];
          return [code(id), code(at), String(e.count)];
        }),
      ),
      table(
        `Groups identical apart from intake_id${identicalApartFromId.length > 10 ? ` (first 10 of ${identicalApartFromId.length})` : ''}`,
        ['rows in group', 'legacy_patient_id', 'submitted_at', 'outcome'],
        identicalApartFromId.slice(0, 10).map((e) => {
          const fields = e.value.split(KEY_SEP);
          const at = (name: string): string => {
            const hi = it.csv.header.indexOf(name);
            return fields[hi > idIdx ? hi - 1 : hi] ?? '';
          };
          return [String(e.count), code(at('legacy_patient_id')), code(at('submitted_at')), code(at('outcome'))];
        }),
      ),
    ],
    json: {
      repeatedPatientSubmittedPairs: dupPairs.length,
      repeatedPatientSubmittedRows: dupPairs.reduce((t, e) => t + e.count, 0),
      intakesPerPatient: perPatientDist.entries().map((e) => ({intakes: Number(e.value), patientIds: e.count})),
      identicalApartFromIntakeIdGroups: identicalApartFromId.length,
      identicalApartFromIntakeIdRows: identicalApartFromId.reduce((t, e) => t + e.count, 0),
    },
  });

  // ---- whole row ----------------------------------------------------------------
  const lineCounter = new Counter();
  for (const l of it.csv.info.lines.slice(1)) lineCounter.add(l);
  const dupLines = lineCounter.entries().filter((e) => e.count > 1);
  sections.push({
    key: `${FILE}.whole-row`,
    title: `${FILE} whole-row structure`,
    group: 'inventory',
    notes: [
      `The header has ${it.csv.header.length} fields. ${it.csv.raggedRows.length} data rows have a different ` +
        `field count. ${it.csv.fieldsWithNewline} fields contain a line break. ${dupLines.length} physical data ` +
        `lines are byte-identical to another line (${dupLines.reduce((t, e) => t + e.count, 0)} lines involved).`,
    ],
    tables: [
      table(
        'Field count per data row',
        ['fields', 'rows'],
        it.csv.fieldCounts
          .entries()
          .sort((a, b) => Number(a.value) - Number(b.value))
          .map((e) => [e.value, String(e.count)]),
      ),
    ],
    json: {
      headerFields: it.csv.header.length,
      raggedRows: it.csv.raggedRows.length,
      fieldsWithNewline: it.csv.fieldsWithNewline,
      duplicatePhysicalLines: dupLines.length,
      fieldCounts: it.csv.fieldCounts.entries().map((e) => ({fields: Number(e.value), rows: e.count})),
    },
  });

  return sections;
}
