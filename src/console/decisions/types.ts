// What a reviewer's click means, as data. A decider turns one action on one review item into the
// three things the resolution path takes — the values to write, the note, and how the item closes
// (ADR-0023). Deciders are pure: they read the item's payload and return a `Decision`, and the
// route does the writing.
//
// This is where "the client carries no business rules" is made true for the console (R-T4,
// `CLAUDE.md` §2). A browser posts *what the reviewer chose* — confirm, reject, exclude these
// rows — never the rows to write. Which values follow from a choice is decided here, on the
// server, from the item the importer raised.
import type { FieldChange } from '@/repo/resolve';

export interface Decision {
  readonly outcome: 'resolved' | 'dismissed';
  readonly note: string;
  readonly changes: readonly FieldChange[];
  /** Rows the decision is about though it changes none of them (see `ResolveRequest.subjects`). */
  readonly subjects?: readonly { readonly entityType: string; readonly entityId: string }[];
  /** Stored on the item: what was chosen, in enough detail to read back years later. */
  readonly resolution: Readonly<Record<string, unknown>>;
}

/**
 * An exported row's canonical patient. `created_from_legacy_id`, never `patient_legacy_ids`: a
 * merge repoints the alias, and a payload names the row as it was exported (ADR-0023 item 5).
 */
export type LegacyPatientLookup = ReadonlyMap<string, string>;

/** A reviewer asked for something the item cannot do. Surfaced to them, not swallowed. */
export class DecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecisionError';
  }
}
