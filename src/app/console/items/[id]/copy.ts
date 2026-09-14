// What a review item's detail pane says beyond its evidence: the one line above it, and the
// explanation folded away below it (ADR-0028).
//
// It is per *kind*, not per row, because that is what it is: why the importer raises this kind of
// item at all, and what taking a decision on one writes. A row-level sentence would be the item's
// own title, which the header already carries.
import type { ReviewItemType } from '@/import/review/items';

export interface ItemCopy {
  /** The one sentence a reviewer needs before the evidence, or null when the evidence speaks. */
  readonly banner: string | null;
  /** Why this reached them. */
  readonly why: string;
  /** What the decision writes — the part that is easy to be wrong about. */
  readonly writes: string;
}

export const ITEM_COPY: Readonly<Record<ReviewItemType, ItemCopy>> = {
  identity_conflict: {
    banner: null,
    why:
      'Four exact keys group the candidates, and only records literally identical on identity and ' +
      'non-contradictory everywhere else were merged by the importer. This pair contradicts, so ' +
      'the decision is a person’s — field by field, with a survivor.',
    writes:
      'A merge moves no row. It writes merged_into and the alias rows, repoints every legacy id, ' +
      'recomputes the consent state, and records which record supplied which field.',
  },
  orphan_intake: {
    banner:
      'The intake carries nothing that identifies a person, so there is nothing to match on. ' +
      'Attach it if you know who it is.',
    why:
      'The export referenced a patient row it did not contain. Attaching is a search, not a ' +
      'suggestion: the console will not guess an identity from body measurements, and there is no ' +
      'button that invents a patient (ADR-0029).',
    writes:
      'Attaching sets the intake’s patient and records who said so. Leaving it unresolved is an ' +
      'acceptable outcome, and the import report counts them.',
  },
  duplicate_intake: {
    banner: 'Both rows stay. The decision is which one is the record of note.',
    why:
      'Two submissions on one day from one patient is usually one intake submitted twice — but the ' +
      'export cannot say so, and deleting either would lose evidence.',
    writes:
      'Neither row is deleted or altered, and neither legacy outcome is rewritten. The choice is ' +
      'recorded against both intakes.',
  },
  consent: {
    banner: null,
    why:
      'Consent is permission to process everything else, so a record whose log is missing or ' +
      'self-contradicting is the import’s most consequential gap. A derived state of conflict is ' +
      'the honest answer, not a guess at which event won.',
    writes:
      'Nothing here writes a consent event — an event is the patient’s act. Establishing a state ' +
      'records the state a person established, carrying their name, and it holds until an event ' +
      'later than the ones on screen arrives (ADR-0025).',
  },
  data_quality: {
    banner: 'The raw row is kept either way.',
    why:
      'The mapper refused a value it could not read rather than storing nonsense, and kept the raw ' +
      'row. A proposal shown here is data on the item, never something the importer applied.',
    writes:
      'All three answers go through one writer, which stores the value, the audit entry and the ' +
      'reason in a single transaction. A value established here is a person’s, and no later import ' +
      'overwrites it.',
  },
  vocabulary: {
    banner: 'One inference over many rows — one decision, applied to the rows that are kept.',
    why:
      'If one rule would create hundreds of identical items, that is one vocabulary-level decision ' +
      'for a human, not hundreds of row decisions (`CLAUDE.md` §5).',
    writes:
      'Rejecting records the answer against the rows listed; it does not rewrite them. Changing ' +
      'the rule itself is a new ruleset version and a re-import.',
  },
  clinical_history: {
    banner: 'The legacy outcome stands. What is open is what to do about it now.',
    why:
      'The importer raised this because today’s detectors, run over history, found something the ' +
      'legacy process could not see. It is not a disagreement with today’s thresholds; those are ' +
      'recorded as shadow evaluations and applied to nothing.',
    writes:
      'Nothing here changes the intake’s outcome or its state. It writes one audit entry against ' +
      'the record: the outcome, the reviewer’s name, and the reason they type.',
  },
};
