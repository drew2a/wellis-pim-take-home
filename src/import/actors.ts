/**
 * The named processes that write audit entries (ADR-0009 item 4). Any actor not in this set is a
 * human, and a field a human names in `audit_entries.changes` is human-owned: the importer never
 * rewrites it (ADR-0004, R-A17). Part B added its two actors here and nowhere else.
 */
export const LEGACY_IMPORT_ACTOR = 'legacy import';
export const IMPORTER_ACTOR = 'importer';
/** Part B: accepts a submission — creating the draft and submitting it (ADR-0014 item 4). */
export const INTAKE_FORM_ACTOR = 'intake form';
/** Part B: applies the verdict. Named apart from the form because "the patient sent this" and
 * "the rules decided this" are different claims, and the audit should be able to say which. */
export const ELIGIBILITY_ENGINE_ACTOR = 'eligibility engine';

export const SYSTEM_ACTORS: ReadonlySet<string> = new Set([
  LEGACY_IMPORT_ACTOR,
  IMPORTER_ACTOR,
  INTAKE_FORM_ACTOR,
  ELIGIBILITY_ENGINE_ACTOR,
]);
