// meds_current and conditions (findings): the raw text is stored unchanged; a derived report
// field says whether the question was answered and, if so, whether the answer was "nothing".
// The "nothing" spellings are the complete set seen in this export, matched exactly; any other
// text is `reported`, classification being the detectors' job.
import { mapped, unchanged, type Mapped } from './types';

export type HistoryReport = 'none_reported' | 'not_answered' | 'reported';

const NONE_MEDICATION: ReadonlySet<string> = new Set([
  'geen',
  '-',
  'geen medicatie',
  'n.v.t.',
  'none',
]);
const NONE_CONDITION: ReadonlySet<string> = new Set(['none', 'geen']);

function mapReport(
  raw: string,
  field: 'medication_report' | 'condition_report',
  none: ReadonlySet<string>,
  ruleCode: 'VOCAB_NONE_MEDICATION' | 'VOCAB_NONE_CONDITION',
): Mapped<HistoryReport> {
  if (raw === '') return unchanged('not_answered');
  if (none.has(raw)) {
    return mapped('none_reported', [{ field, from: raw, to: 'none_reported', ruleCode }]);
  }
  return unchanged('reported');
}

export const mapMedicationReport = (raw: string): Mapped<HistoryReport> =>
  mapReport(raw, 'medication_report', NONE_MEDICATION, 'VOCAB_NONE_MEDICATION');

export const mapConditionReport = (raw: string): Mapped<HistoryReport> =>
  mapReport(raw, 'condition_report', NONE_CONDITION, 'VOCAB_NONE_CONDITION');
