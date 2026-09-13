// The consent text a patient agrees to in the new intake flow, next to its version (ADR-0015
// item 4). `v3` is the next value in the sequence the export already uses — `v1` on 1136 events
// and `v2` on 1507 — because this is the next consent text the company puts in front of a patient.
//
// Versioned independently of the ruleset: what the patient agreed to and which rules judged them
// are two different facts. A consent event stores this version, so a later text never changes what
// an earlier patient consented to.

export const CONSENT_TEXT_VERSION = 'v3';

/** The one consent type the export declares (`src/import/mapper/vocabulary.ts`). */
export const CONSENT_TYPE_DATA_PROCESSING = 'data_processing';

export const CONSENT_TEXT = `I agree that Wellis may process the health data I provide in this
form — my date of birth, height, weight, medication use and medical conditions — in order to
assess whether their weight-care programme is suitable for me, and that a member of the Wellis
care team may read it for that purpose.

I understand that I can withdraw this consent at any time by contacting Wellis, and that
withdrawing it does not affect the lawfulness of the processing that took place before.`;
