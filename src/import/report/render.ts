// The Markdown rendering of the import report: a pure function of the JSON, so the two files can
// never disagree and the Markdown can be regenerated from the committed JSON alone. No I/O, no
// clock, no database — everything it prints is already a number in the report (ADR-0011 item 14).
import type {
  Assumption,
  ImportReport,
  MatrixCell,
  RuleApplied,
  Tally,
  UnexpectedFinding,
} from './types';

const NONE = '—';

function table(headers: readonly string[], body: readonly (readonly string[])[]): string[] {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...body.map((row) => `| ${row.join(' | ')} |`),
  ];
}

const number = (value: number): string => String(value);

const inline = (value: unknown): string => `\`${JSON.stringify(value)}\``;

function tallyTable(title: string, entries: readonly Tally[], unit = 'rows'): string[] {
  if (entries.length === 0) return [`${title}: none.`, ''];
  return [
    ...table(
      [title, unit],
      entries.map((entry) => [`\`${entry.key}\``, number(entry.rows)]),
    ),
    '',
  ];
}

const total = (entries: readonly Tally[]): number =>
  entries.reduce((sum, entry) => sum + entry.rows, 0);

function whatCameIn(report: ImportReport): string[] {
  const came = report.whatCameIn;
  return [
    '## What came in',
    '',
    ...table(
      ['file', 'bytes', 'sha256'],
      came.files.map((file) => [`\`${file.name}\``, number(file.bytes), `\`${file.sha256}\``]),
    ),
    '',
    'Every row is stored as exported before anything is interpreted (R-A8).',
    '',
    ...table(
      ['stored', 'rows'],
      [
        ...came.rawRows.map((row) => [`\`${row.key}\``, number(row.rows)]),
        ['patients (legacy rows)', number(came.patients.legacyRows)],
        ['&nbsp;&nbsp;surviving after merges', number(came.patients.surviving)],
        ['&nbsp;&nbsp;merged away, kept and still resolving', number(came.patients.mergedAway)],
        ['legacy ids resolving to a patient', number(came.patients.legacyIdsResolving)],
        ['intakes', number(came.intakes.rows)],
        ['&nbsp;&nbsp;orphans: no patient row in the export', number(came.intakes.orphans)],
        ['consent events', number(came.consentEvents.rows)],
        [
          '&nbsp;&nbsp;referencing a patient that does not exist',
          number(came.consentEvents.withoutPatient),
        ],
        ['natural keys the export repeats with different values', number(came.repeatedKeys)],
        ['rows whose source changed since an earlier run', number(came.changedSinceEarlierRun)],
      ],
    ),
    '',
  ];
}

function cleanedRow(rule: RuleApplied): string[] {
  return [
    `\`${rule.rule}\``,
    number(rule.rows),
    rule.blanked === 0 ? NONE : number(rule.blanked),
    rule.fields.map((field) => `${field.key} ${field.rows}`).join(', '),
    inline(rule.evidence),
  ];
}

function whatWasCleaned(report: ImportReport): string[] {
  const cleaned = report.whatWasCleaned;
  const daylight = cleaned.daylightSaving;
  return [
    '## What was cleaned',
    '',
    `${cleaned.records} normalisation records over ${cleaned.byRule.length} rule codes: one row ` +
      'per stored value that differs from the raw value, with the rule that changed it and the ' +
      'evidence that rule rests on (R-A7). A blanked value is a value we refused to guess; it ' +
      'keeps its raw form in the `legacy_*_raw` tables and has a review item of its own.',
    '',
    ...table(
      ['rule', 'rows', 'of which blanked', 'fields', 'evidence'],
      cleaned.byRule.map(cleanedRow),
    ),
    '',
    `Legacy consent times are wall-clock values read as Europe/Amsterdam: ${daylight.ambiguous} ` +
      `fall in the autumn hour that happens twice and ${daylight.nonexistent} in the spring hour ` +
      'that does not exist.',
    '',
  ];
}

function whatWasQuarantined(report: ImportReport): string[] {
  const quarantined = report.whatWasQuarantined;
  return [
    '## What was quarantined',
    '',
    `${quarantined.items} review items: a decision the importer could not make safely, handed to ` +
      'a human with the context to make it (R-A10). A rule that would produce hundreds of ' +
      'identical items produces one vocabulary-level item instead; a row-level item is raised ' +
      'only where the consequence differs per row.',
    '',
    ...table(
      ['type', 'scope', 'items'],
      quarantined.byTypeAndScope.map((entry) => [
        `\`${entry.type}\``,
        entry.scope,
        number(entry.items),
      ]),
    ),
    '',
    ...table(
      ['rule', 'type', 'scope', 'items'],
      quarantined.byRule.map((entry) => [
        `\`${entry.rule}\``,
        entry.type,
        entry.scope,
        number(entry.items),
      ]),
    ),
    '',
    ...tallyTable('status', quarantined.byStatus, 'items'),
  ];
}

function assumption(entry: Assumption): string[] {
  return [
    entry.statement,
    entry.rule === null ? NONE : `\`${entry.rule}\``,
    entry.rows === null ? NONE : number(entry.rows),
    inline(entry.evidence),
  ];
}

function rulesApplied(report: ImportReport): string[] {
  return [
    '## Rules applied, and the assumptions under them',
    '',
    'Deterministic conversions are in the table above. These are the readings the export does ' +
      'not state: each was tested against the whole export, each carries the count it changed, ' +
      'and each has a confirmation item in the queue, so a "no" identifies exactly which rows to ' +
      'remap (R-A22).',
    '',
    ...table(['assumption', 'rule', 'rows', 'evidence'], report.rulesApplied.map(assumption)),
    '',
  ];
}

function identity(report: ImportReport): string[] {
  const id = report.identity;
  return [
    '## Identity: duplicate patient records',
    '',
    `${id.candidates} candidate groups, every one of them a pair. Only a group that is literally ` +
      'identical on identity and non-contradictory on everything else is merged by the importer; ' +
      'everything else is a decision for a human, shown side by side with no proposed winner.',
    '',
    ...table(
      ['tier', 'groups', 'what the importer did'],
      [
        ['1: identical on identity', number(id.tier1Merged), 'merged, with an audit entry each'],
        ['1: already decided by a human', number(id.tier1HumanDecided), 'left alone, counted'],
        ['2: same person, differing fields', number(id.tier2), 'review item, side by side'],
        ['3: shared key, contradicting', number(id.tier3), 'review item, marked a conflict'],
      ],
    ),
    '',
    ...tallyTable('survivor chosen because', id.survivorRule, 'pairs'),
    `A merge writes two things: \`merged_into\` on the loser and the alias rows that pointed at ` +
      'it. Nothing is deleted, every legacy id keeps resolving, and the fields a survivor took ' +
      `from its loser (${id.fieldsGainedFromLosers} in this export) carry per-field provenance ` +
      'in the audit entry, so every merge can be taken back by writing the same two things back.',
    '',
  ];
}

function consent(report: ImportReport): string[] {
  const c = report.consent;
  const timing = c.timing;
  const future = total(c.futureDatedEvents);
  return [
    '## Consent',
    '',
    'The log is evidence and is never touched; the state is what we act on. It is derived per ' +
      'patient and per consent type from the events in timestamp order — not in file order, ' +
      'which disagrees — with a revocation winning a tie, and a log whose first event is a ' +
      'revocation reading as `conflict` rather than as either of the two things it could mean.',
    '',
    ...tallyTable('state, per surviving patient', c.statesPerPatient, 'patients'),
    ...tallyTable('state, per legacy row before merges', c.statesPerLegacyRow, 'rows'),
    'Two things separate the two tables, and between them they account for it exactly. The ' +
      `merged-away rows take their own state with them (${total(c.statesOfMergedAwayRows)}: ` +
      c.statesOfMergedAwayRows.map((entry) => `${entry.rows} \`${entry.key}\``).join(', ') +
      '), because a duplicate row is not a second person to chase for consent. And a merge hands ' +
      "the survivor its duplicate's events — a merge moves no event, and a patient's records are " +
      'the union its membership returns — so some survivors change state:',
    '',
    ...tallyTable('survivor state changed by a merge', c.statesChangedByMerge, 'patients'),
    'That second table is the reason a duplicate matters here beyond tidiness: for those ' +
      'patients the consent record was on the row we were about to stop looking at.',
    '',
    ...tallyTable('items raised, per surviving patient', c.itemsPerPatient, 'items'),
    ...tallyTable('items the same rules raise per legacy row', c.itemsPerLegacyRow, 'items'),
    '### What the log says about the medical record',
    '',
    'Both figures count intakes whose submission date the mapper could read, against the ' +
      "timestamps of that legacy row's own events, in Europe/Amsterdam days.",
    '',
    ...table(
      ['finding', 'intakes'],
      [
        [
          'submitted before the calendar day of the first grant ' +
            `(${timing.patientsWithAnIntakeBeforeFirstGrant} patients)`,
          number(timing.intakesBeforeFirstGrant),
        ],
        [
          'submitted after a revocation with no later grant',
          number(timing.intakesAfterRevocationWithNoLaterGrant),
        ],
      ],
    ),
    '',
    `${future} events are dated after \`--as-of ${report.asOf}\` (` +
      c.futureDatedEvents.map((entry) => `${entry.rows} ${entry.key}`).join(', ') +
      '). Their states stand as derived: honouring a revocation that may be mis-timed costs a ' +
      're-consent, ignoring a real one is a breach. One vocabulary item asks about the ' +
      'timestamps and lists every event.',
    '',
  ];
}

function matrix(cells: readonly MatrixCell[]): string[] {
  const engines = [...new Set(cells.map((cell) => cell.engineOutcome))].sort();
  const legacy = [...new Set(cells.map((cell) => cell.legacyOutcome))].sort();
  const at = (engine: string, outcome: string): number =>
    cells.find((cell) => cell.engineOutcome === engine && cell.legacyOutcome === outcome)
      ?.intakes ?? 0;
  return table(
    ['engine outcome \\ legacy outcome', ...legacy],
    engines.map((engine) => [
      `\`${engine}\``,
      ...legacy.map((outcome) => number(at(engine, outcome))),
    ]),
  );
}

function shadow(report: ImportReport): string[] {
  const s = report.shadowEvaluation;
  const hard = s.hardDisagreements;
  const carveOut = s.unreadableOutcomeCarveOut;
  return [
    '## The ruleset against history (shadow evaluation)',
    '',
    `Every one of the ${s.evaluations} legacy intakes was evaluated with the ruleset the console ` +
      'would apply today, and **nothing was applied**: each intake keeps the state its legacy ' +
      'outcome gave it. Queueing those disagreements would be wrong — the doctor who approved a ' +
      '2024 intake saw its BMI.',
    '',
    ...matrix(s.matrix),
    '',
    `**Hard disagreements** are two cells and only two: \`auto_rejected\` where the legacy ` +
      `outcome was approved (${hard.autoRejectedWhereLegacyApproved}) and \`auto_cleared\` where ` +
      `it was rejected (${hard.autoClearedWhereLegacyRejected}). \`auto_flagged\` is never one: ` +
      'it means a human should look, and a human did. `not_evaluable` ' +
      `(${s.notEvaluable}) is compared with nothing — the rules could not run, so they ` +
      'contradict no decision.',
    '',
    ...tallyTable('rules that would fire on a legacy intake today', s.ruleHits, 'intakes'),
    'Items are raised only where the legacy process could not see the problem — a medication or ' +
      'a condition buried in free text — or where the question is a legal one:',
    '',
    ...table(
      ['rule', 'legacy outcome', 'intakes'],
      s.itemsRaised.map((item) => [`\`${item.rule}\``, item.legacyOutcome, number(item.intakes)]),
    ),
    '',
    `An outcome spelling nobody could read counts as open for a minor's intake: this export has ` +
      `${carveOut.unreadableOutcomes} unreadable outcomes and ${carveOut.minorsAmongThem} of ` +
      'them belongs to a minor.',
    '',
  ];
}

function finding(entry: UnexpectedFinding): string[] {
  const numbers = Object.entries(entry.numbers)
    .map(([key, value]) => `${key} **${value}**`)
    .join(', ');
  return [`- ${entry.finding} — ${numbers}. _${entry.notCovered}_ (${entry.evidence})`];
}

function notInExportNotes(report: ImportReport): string[] {
  return [
    '## Not in EXPORT-NOTES.md',
    '',
    'What the previous team did not warn us about, in the order it matters (R-A23). Each line is ' +
      'a count over the loaded export, with the profile section that established it.',
    '',
    ...report.notInExportNotes.flatMap(finding),
    '',
  ];
}

export function renderMarkdown(report: ImportReport): string {
  const lines = [
    '# Import report',
    '',
    'Wellis Intake, Part A: what the legacy export contains, what the importer changed, what it ' +
      'refused to change and what nobody warned us about.',
    '',
    'This is a statement about **the export**, not about a run: it carries the inputs every ' +
      'number depends on and no run id and no clock, so two runs over one export produce ' +
      'byte-identical files and a diff of this file is a change in the data or in the rules. ' +
      'Every number is produced by `npm run import`, none is typed by hand.',
    '',
    ...table(
      ['input', 'value'],
      [
        ['`--as-of`', `\`${report.asOf}\``],
        ['importer version', `\`${report.importerVersion}\``],
        ['ruleset version', `\`${report.rulesetVersion}\``],
      ],
    ),
    '',
    ...whatCameIn(report),
    ...whatWasCleaned(report),
    ...whatWasQuarantined(report),
    ...rulesApplied(report),
    ...identity(report),
    ...consent(report),
    ...shadow(report),
    ...notInExportNotes(report),
  ];
  return `${lines.join('\n').trimEnd()}\n`;
}
