// One consent log line to its canonical event (ADR-0004 `consent_events`). Events are stored as
// exported except `at`, which becomes an instant (ADR-0007). When the action is unseen or the
// time unreadable no canonical event can be written; the raw row stays and the flag says why
// (ADR-0009 item 8).
import type { ConsentLine } from '../source/jsonl';
import { mapConsentAt } from './consent-at';
import { collect, emptyToNull } from './patient';
import type { Flag, RecordDraft } from './types';
import { CONSENT_ACTION, CONSENT_TYPES, mapVocabulary, type ConsentAction } from './vocabulary';

export interface CanonicalConsentEvent {
  readonly type: string;
  readonly action: ConsentAction;
  readonly at: Date;
  readonly version: string | null;
}

export interface MappedConsentEvent {
  readonly lineNo: number;
  readonly legacyPatientId: string;
  /** Null when the line cannot become an event: see the flags. */
  readonly canonical: CanonicalConsentEvent | null;
  readonly records: readonly RecordDraft[];
  readonly flags: readonly Flag[];
}

export function mapConsentEvent(lineNo: number, raw: ConsentLine): MappedConsentEvent {
  const records: RecordDraft[] = [];
  const flags: Flag[] = [];
  const take = collect(records, flags);

  const action = take(mapVocabulary(raw.action, CONSENT_ACTION));
  const at = take(mapConsentAt(raw.at));
  if (!CONSENT_TYPES.has(raw.type)) {
    flags.push({ kind: 'vocabulary_unseen', field: 'type', raw: raw.type });
  }

  return {
    lineNo,
    legacyPatientId: raw.patient_legacy_id,
    canonical:
      action === null || at === null
        ? null
        : { type: raw.type, action, at, version: emptyToNull(raw.version) },
    records,
    flags,
  };
}
