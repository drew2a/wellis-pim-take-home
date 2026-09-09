/**
 * Inventories for `legacy_export/consents.jsonl`.
 *
 * The log is evidence and the consent state is what a later system would act on
 * (CLAUDE.md §6), so this module reports the event inventory *and* what two different
 * orderings of the same events would derive, without choosing between them.
 */
import {code, table, type Section, type Table} from './report.js';
import {Counter, Grouper, fold, readFileInfo, shape, type FileInfo} from './util.js';

const FILE = 'consents.jsonl';

export interface ConsentEvent {
  /** 1-based physical line number, so a finding can be pointed at. */
  readonly line: number;
  readonly patientId: string;
  readonly type: string;
  readonly action: string;
  readonly at: string;
  readonly version: string;
  readonly keys: readonly string[];
  readonly raw: string;
}

export interface Consents {
  readonly info: FileInfo;
  readonly events: readonly ConsentEvent[];
  readonly invalidLines: readonly number[];
  readonly blankLines: readonly number[];
  readonly patientIds: ReadonlySet<string>;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v);
}

export function loadConsents(path: string): Consents {
  const info = readFileInfo(path);
  const events: ConsentEvent[] = [];
  const invalidLines: number[] = [];
  const blankLines: number[] = [];
  info.lines.forEach((raw, i) => {
    const line = i + 1;
    if (raw.trim() === '') {
      blankLines.push(line);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      invalidLines.push(line);
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      invalidLines.push(line);
      return;
    }
    const obj = parsed as Record<string, unknown>;
    events.push({
      line,
      patientId: asString(obj['patient_legacy_id']),
      type: asString(obj['type']),
      action: asString(obj['action']),
      at: asString(obj['at']),
      version: asString(obj['version']),
      keys: Object.keys(obj).sort(),
      raw,
    });
  });
  return {
    info,
    events,
    invalidLines,
    blankLines,
    patientIds: new Set(events.map((e) => e.patientId)),
  };
}

/** Value counts keyed by the value itself, so a JSON consumer can name what it reads. */
function countOf(values: readonly string[]): Record<string, number> {
  const c = new Counter();
  for (const v of values) c.add(v);
  return Object.fromEntries(c.entries().map((e) => [e.value, e.count]));
}

function valueTable(caption: string, values: readonly string[]): Table {
  const c = new Counter();
  for (const v of values) c.add(v);
  return table(
    caption,
    ['raw value', 'count', 'folded'],
    c.entries().map((e) => [code(e.value), String(e.count), code(fold(e.value))]),
  );
}

export interface ConsentsContext {
  /** Latest date seen in the two CSVs, used as the "future" reference. */
  readonly now: string;
  /** Second reference: the same, once the isolated tail of dates is set aside (P-35). */
  readonly bulkNow: string;
  readonly patientLegacyIds: ReadonlySet<string>;
}

export function consentsSections(c: Consents, ctx: ConsentsContext): Section[] {
  const sections: Section[] = [];
  const ev = c.events;

  // ---- file and key inventory ---------------------------------------------------
  const keySets = new Counter();
  for (const e of ev) keySets.add(e.keys.join(', '));
  const dupLines = new Counter();
  for (const e of ev) dupLines.add(e.raw);
  const duplicateLines = dupLines.entries().filter((e) => e.count > 1);
  sections.push({
    key: `${FILE}.structure`,
    title: `${FILE} line validity and key sets`,
    group: 'inventory',
    notes: [
      `${c.info.physicalLines} physical lines, ${c.blankLines.length} blank, ${c.invalidLines.length} that do ` +
        `not parse as a JSON object${c.invalidLines.length > 0 ? ` (lines ${c.invalidLines.slice(0, 20).join(', ')})` : ''}, ` +
        `${ev.length} events. ${duplicateLines.length} lines are byte-identical to another line ` +
        `(${duplicateLines.reduce((t, e) => t + e.count, 0)} lines involved).`,
    ],
    tables: [
      table(
        'Complete key-set inventory',
        ['keys present', 'lines'],
        keySets.entries().map((e) => [code(e.value), String(e.count)]),
      ),
      table(
        `Duplicate lines${duplicateLines.length > 10 ? ` (first 10 of ${duplicateLines.length})` : ''}`,
        ['line', 'occurrences'],
        duplicateLines.slice(0, 10).map((e) => [code(e.value), String(e.count)]),
      ),
    ],
    json: {
      physicalLines: c.info.physicalLines,
      blankLines: c.blankLines,
      invalidLines: c.invalidLines,
      events: ev.length,
      keySets: keySets.entries().map((e) => ({keys: e.value.split(', '), lines: e.count})),
      duplicateLineGroups: duplicateLines.length,
      duplicateLineRows: duplicateLines.reduce((t, e) => t + e.count, 0),
    },
  });

  // ---- type, action, version ----------------------------------------------------
  sections.push({
    key: `${FILE}.type-action-version`,
    title: `${FILE} type, action and version values`,
    group: 'inventory',
    notes: [
      `Complete value inventories for the three enumerated fields. EXPORT-NOTES.md claims only ` +
        `\`data_processing\` exists for type and only \`granted\` / \`revoked\` for action.`,
    ],
    tables: [
      valueTable('type', ev.map((e) => e.type)),
      valueTable('action', ev.map((e) => e.action)),
      valueTable('version', ev.map((e) => e.version)),
    ],
    json: {
      types: countOf(ev.map((e) => e.type)),
      actions: countOf(ev.map((e) => e.action)),
      versions: countOf(ev.map((e) => e.version)),
    },
  });

  // ---- at -----------------------------------------------------------------------
  const atShapes = new Grouper();
  for (const e of ev) atShapes.add(shape(e.at), e.at);
  const withTz = ev.filter((e) => /(Z|[+-]\d{2}:?\d{2})$/u.test(e.at));
  const withSeconds = ev.filter((e) => /\d{2}:\d{2}:\d{2}/u.test(e.at));
  const dateOnly = ev.filter((e) => !/\d{2}:\d{2}/u.test(e.at));
  const sortedAt = [...ev].map((e) => e.at).sort();
  const future = ev.filter((e) => e.at.slice(0, 10) > ctx.now);
  const futureBulk = ev.filter((e) => e.at.slice(0, 10) > ctx.bulkNow);
  const before2023 = ev.filter((e) => e.at.slice(0, 10) < '2023-01-01');
  const byPatient = new Map<string, ConsentEvent[]>();
  for (const e of ev) {
    const list = byPatient.get(e.patientId);
    if (list === undefined) byPatient.set(e.patientId, [e]);
    else list.push(e);
  }
  const onlyBefore2023 = [...byPatient.entries()].filter(([, list]) => list.every((e) => e.at.slice(0, 10) < '2023-01-01'));
  sections.push({
    key: `${FILE}.at`,
    title: `${FILE}.at`,
    group: 'inventory',
    notes: [
      `${ev.length} values, ${new Set(ev.map((e) => e.at)).size} distinct, ${atShapes.size} distinct shape. ` +
        `${withTz.length} values carry a timezone suffix, ${withSeconds.length} carry seconds, ${dateOnly.length} ` +
        `carry no time at all.`,
      `Range as strings: ${sortedAt[0] ?? '-'} to ${sortedAt[sortedAt.length - 1] ?? '-'}. ${future.length} events ` +
        `are dated after ${ctx.now}, the latest date seen in the two CSV files, and ${futureBulk.length} are dated ` +
        `after the second reference ${ctx.bulkNow}. ${before2023.length} events are dated before 2023-01-01, and ` +
        `${onlyBefore2023.length} patients have no event dated 2023 or later.`,
    ],
    tables: [
      table(
        'Complete shape inventory',
        ['shape', 'count', 'examples'],
        atShapes.entries().map((e) => [code(e.key), String(e.count), e.examples.map((x) => code(x)).join(' ')]),
      ),
    ],
    json: {
      shapes: atShapes.entries().map((e) => ({shape: e.key, count: e.count, examples: e.examples})),
      withTimezoneSuffix: withTz.length,
      withSeconds: withSeconds.length,
      dateOnly: dateOnly.length,
      earliest: sortedAt[0] ?? null,
      latest: sortedAt[sortedAt.length - 1] ?? null,
      eventsAfterCsvLatestDate: future.length,
      eventsAfterBulkReference: futureBulk.length,
      eventsBefore2023: before2023.length,
      patientsWithNoEventFrom2023: onlyBefore2023.length,
    },
  });

  // ---- patient_legacy_id --------------------------------------------------------
  const resolved = ev.filter((e) => ctx.patientLegacyIds.has(e.patientId));
  const orphanIds = [...new Set(ev.filter((e) => !ctx.patientLegacyIds.has(e.patientId)).map((e) => e.patientId))].sort();
  const patientsWithoutEvents = [...ctx.patientLegacyIds].filter((id) => !byPatient.has(id));
  const eventsPerPatient = new Counter();
  for (const [, list] of byPatient) eventsPerPatient.add(String(list.length));
  sections.push({
    key: `${FILE}.patient_legacy_id`,
    title: `${FILE}.patient_legacy_id`,
    group: 'inventory',
    notes: [
      `${resolved.length} events resolve to a patients.csv legacy_id and ${ev.length - resolved.length} do not ` +
        `(${orphanIds.length} distinct unresolved ids). ${byPatient.size} distinct patient ids appear in the log; ` +
        `${patientsWithoutEvents.length} of the ${ctx.patientLegacyIds.size} patients.csv ids have no event at all.`,
    ],
    tables: [
      table(
        'Events per patient id',
        ['events', 'patient ids'],
        eventsPerPatient
          .entries()
          .sort((a, b) => Number(a.value) - Number(b.value))
          .map((e) => [e.value, String(e.count)]),
      ),
      table(
        `Unresolved patient ids${orphanIds.length > 20 ? ` (first 20 of ${orphanIds.length})` : ''}`,
        ['patient_legacy_id', 'events'],
        orphanIds.slice(0, 20).map((id) => [code(id), String(ev.filter((e) => e.patientId === id).length)]),
      ),
    ],
    json: {
      resolvedEvents: resolved.length,
      unresolvedEvents: ev.length - resolved.length,
      unresolvedIds: orphanIds,
      distinctPatientIds: byPatient.size,
      patientsWithoutEvents: patientsWithoutEvents.length,
      eventsPerPatient: eventsPerPatient.entries().map((e) => ({events: Number(e.value), patientIds: e.count})),
    },
  });

  // ---- sequences ----------------------------------------------------------------
  const pattern = new Counter();
  let outOfFileOrder = 0;
  let repeatedIdentical = 0;
  let revokedFirst = 0;
  let moreThanTwo = 0;
  const byAt = new Map<string, string>();
  const byFileOrder = new Map<string, string>();
  for (const [id, list] of byPatient) {
    const fileOrder = [...list].sort((a, b) => a.line - b.line);
    // Tie-break: equal `at` keeps file order, so the ordering is total and reproducible.
    const atOrder = [...list].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.line - b.line));
    if (fileOrder.some((e, i) => e.line !== (atOrder[i] as ConsentEvent).line)) outOfFileOrder++;
    const actions = atOrder.map((e) => e.action);
    if (actions.some((a, i) => i > 0 && a === actions[i - 1])) repeatedIdentical++;
    if (actions[0] === 'revoked') revokedFirst++;
    if (actions.length > 2) moreThanTwo++;
    const uniq = [...new Set(actions)];
    const label =
      actions.length === 1
        ? `single ${actions[0] as string}`
        : uniq.length === 1
          ? `${actions.length} x ${actions[0] as string}`
          : actions[0] === 'granted' && (actions[actions.length - 1] as string) === 'revoked'
            ? 'granted then revoked'
            : actions[0] === 'revoked' && (actions[actions.length - 1] as string) === 'granted'
              ? 'revoked then granted'
              : `mixed (${actions.join(' > ')})`;
    pattern.add(label);
    byAt.set(id, atOrder[atOrder.length - 1]?.action ?? '');
    byFileOrder.set(id, fileOrder[fileOrder.length - 1]?.action ?? '');
  }
  const lastStateAt = new Counter();
  for (const [, s] of byAt) lastStateAt.add(s);
  const lastStateFile = new Counter();
  for (const [, s] of byFileOrder) lastStateFile.add(s);
  const differing = [...byAt.entries()].filter(([id, s]) => byFileOrder.get(id) !== s);
  const noEvents = [...ctx.patientLegacyIds].filter((id) => !byPatient.has(id)).length;
  sections.push({
    key: `${FILE}.sequences`,
    title: `${FILE} per-patient event sequences and derived state`,
    group: 'inventory',
    notes: [
      `Sequences are ordered by \`at\`, with equal timestamps keeping file order. ` +
        `${outOfFileOrder} patients have a file order that differs from their \`at\` order. ` +
        `${repeatedIdentical} patients have the same action twice in a row, ${revokedFirst} patients start with ` +
        `\`revoked\` and so have no prior grant in this log, ${moreThanTwo} patients have more than two events.`,
      `Derived last state under \`at\` order: ` +
        `${lastStateAt.entries().map((e) => `${e.value === '' ? '(empty)' : e.value} ${e.count}`).join(', ')}; ` +
        `plus ${noEvents} patients.csv ids with no event. Deriving from file order instead changes the last ` +
        `state for ${differing.length} patients.`,
    ],
    tables: [
      table(
        'Complete sequence-pattern inventory',
        ['pattern (ordered by at)', 'patients'],
        pattern.entries().map((e) => [e.value, String(e.count)]),
      ),
      table(
        'Derived last state per patient',
        ['last state', 'by at order', 'by file order'],
        [...new Set([...lastStateAt.keys(), ...lastStateFile.keys()])]
          .sort()
          .map((k) => [k === '' ? '(empty)' : code(k), String(lastStateAt.get(k)), String(lastStateFile.get(k))])
          .concat([['no events in the log', String(noEvents), String(noEvents)]]),
      ),
      table(
        `Patients whose derived last state differs between the two orderings${differing.length > 15 ? ` (first 15 of ${differing.length})` : ''}`,
        ['patient_legacy_id', 'by at order', 'by file order'],
        differing
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .slice(0, 15)
          .map(([id, s]) => [code(id), code(s), code(byFileOrder.get(id) ?? '')]),
      ),
    ],
    json: {
      patternCounts: pattern.entries().map((e) => ({pattern: e.value, patients: e.count})),
      patientsWithFileOrderDifferentFromAtOrder: outOfFileOrder,
      patientsWithRepeatedIdenticalAction: repeatedIdentical,
      patientsStartingWithRevoked: revokedFirst,
      patientsWithMoreThanTwoEvents: moreThanTwo,
      lastStateByAtOrder: Object.fromEntries(lastStateAt.entries().map((e) => [e.value, e.count])),
      lastStateByFileOrder: Object.fromEntries(lastStateFile.entries().map((e) => [e.value, e.count])),
      patientsWithNoEvents: noEvents,
      patientsWhoseLastStateDiffersByOrdering: differing.map(([id, s]) => ({
        patientId: id,
        byAtOrder: s,
        byFileOrder: byFileOrder.get(id) ?? '',
      })),
    },
  });

  return sections;
}
