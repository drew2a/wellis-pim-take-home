/**
 * The import report of ASSIGNMENT.md §3A (R-A18 to R-A23): what came in, what was cleaned, what
 * was quarantined, the rules applied and what `EXPORT-NOTES.md` did not warn about.
 *
 * It is a statement about **the export, not the run** (ADR-0011 item 14): it carries `--as-of`,
 * the importer version and the ruleset version — the inputs every number depends on — and no run
 * id and no wall-clock, so two runs over one export render byte-identical files and a diff of the
 * committed report is a change in the data or in the rules. The run keeps the link through
 * `import_runs.report_path`.
 *
 * Every number is a count over the loaded database (`CLAUDE.md` §5), with two stated exceptions
 * named where they appear: the per-rule hits of the shadow evaluation, which the engine reports
 * and no column stores (ADR-0011 item 21), and the consent states per legacy row, which the same
 * pure derivation produces for a row that a merge left without a state of its own.
 *
 * Keys are camelCase, as in `docs/profile/data-profile.json`; every array is sorted, because a
 * report that depends on the order a database returned rows in is not reproducible (ADR-0012).
 */

export interface ReportFile {
  readonly name: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface Tally {
  readonly key: string;
  readonly rows: number;
}

export interface WhatCameIn {
  readonly files: readonly ReportFile[];
  /** Rows stored per raw table: the export as it arrived, byte-faithful (R-A8). */
  readonly rawRows: readonly Tally[];
  /** Natural keys the export repeats with different values; the raw table holds the first. */
  readonly repeatedKeys: number;
  /** Rows whose source changed since an earlier run; the stored row is kept (ADR-0008). */
  readonly changedSinceEarlierRun: number;
  readonly patients: {
    readonly legacyRows: number;
    readonly surviving: number;
    readonly mergedAway: number;
    /** Legacy ids that still resolve to a patient — all of them, also after a merge (ADR-0006). */
    readonly legacyIdsResolving: number;
  };
  readonly intakes: {
    readonly rows: number;
    /** Intakes whose legacy patient is in no file (ADR-0006): kept, with an item each. */
    readonly orphans: number;
  };
  readonly consentEvents: {
    readonly rows: number;
    readonly withoutPatient: number;
  };
}

export interface RuleApplied {
  readonly rule: string;
  readonly rows: number;
  /** Rows the rule blanked: a null is not a resolved value (ADR-0009 item 2). */
  readonly blanked: number;
  readonly fields: readonly Tally[];
  /** The P-n / H-n reference the rule rests on, as stored on its records. */
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface WhatWasCleaned {
  readonly records: number;
  readonly byRule: readonly RuleApplied[];
  /**
   * Legacy consent times converted from Europe/Amsterdam wall time: values in the fall-back hour
   * are ambiguous, values in the spring gap do not exist (`TIMESTAMP_ZONE_ASSUMED`).
   */
  readonly daylightSaving: { readonly ambiguous: number; readonly nonexistent: number };
}

export interface QuarantinedType {
  readonly type: string;
  readonly scope: string;
  readonly items: number;
}

export interface QuarantinedRule extends QuarantinedType {
  /** The rule that raised the item, read back from `dedupe_key` — its only home (ADR-0004). */
  readonly rule: string;
}

export interface WhatWasQuarantined {
  readonly items: number;
  readonly byStatus: readonly Tally[];
  readonly byTypeAndScope: readonly QuarantinedType[];
  readonly byRule: readonly QuarantinedRule[];
}

export interface Assumption {
  readonly statement: string;
  /** The rule code whose records carry the change, or null for an assumption that changes nothing. */
  readonly rule: string | null;
  /** Rows the assumption touched, or null where it is a parameter rather than a row change. */
  readonly rows: number | null;
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface Identity {
  /** Tier-1 pairs the importer merged, tier-2 and tier-3 groups a human decides (ADR-0006). */
  readonly candidates: number;
  readonly tier1Merged: number;
  readonly tier2: number;
  readonly tier3: number;
  /** Tier-1 pairs a human has already decided; the importer leaves them alone (ADR-0012 item 2). */
  readonly tier1HumanDecided: number;
  /** The clause that chose each survivor, from the merge's own audit entry. */
  readonly survivorRule: readonly Tally[];
  /** Fields a survivor took from its loser, with per-field provenance (ADR-0011 item 9). */
  readonly fieldsGainedFromLosers: number;
}

export interface ConsentTiming {
  readonly intakesBeforeFirstGrant: number;
  readonly patientsWithAnIntakeBeforeFirstGrant: number;
  readonly intakesAfterRevocationWithNoLaterGrant: number;
  /**
   * Intakes the comparison could not include, and the patients they belong to: the mapper nulled
   * their submission date as impossible, so the canonical row has no date to compare. They are
   * the difference between these figures and the profiling session's, which read the raw dates.
   */
  readonly intakesExcludedForAnUnreadableDate: number;
  readonly patientsExcludedForAnUnreadableDate: number;
}

export interface Consent {
  /** One row per surviving patient and declared type, from `consent_states`. */
  readonly statesPerPatient: readonly Tally[];
  /** The same derivation over each legacy row's own events, before any merge. */
  readonly statesPerLegacyRow: readonly Tally[];
  /** The states the merged-away rows held, derived from the events they arrived with. */
  readonly statesOfMergedAwayRows: readonly Tally[];
  /**
   * Survivors whose state changed because the merge handed them their duplicate's events, keyed
   * `own state -> state after the merge`. A merge moves no event (ADR-0011 item 3), so a
   * survivor's state is derived over the union its membership returns: the two tables above
   * differ by the rows that went away *and* by these.
   */
  readonly statesChangedByMerge: readonly Tally[];
  readonly itemsPerPatient: readonly Tally[];
  readonly itemsPerLegacyRow: readonly Tally[];
  readonly timing: ConsentTiming;
  readonly futureDatedEvents: readonly Tally[];
}

export interface MatrixCell {
  readonly engineOutcome: string;
  readonly legacyOutcome: string;
  readonly intakes: number;
}

export interface HistoryItems {
  readonly rule: string;
  readonly legacyOutcome: string;
  readonly intakes: number;
}

export interface ShadowEvaluationReport {
  readonly evaluations: number;
  /** The engine's outcomes by the legacy outcomes, one count per cell (ADR-0011 item 11). */
  readonly matrix: readonly MatrixCell[];
  /**
   * The two cells ADR-0011 item 11 calls hard disagreements. `auto_flagged` is never one — it
   * means a human should look, and a human did — and `not_evaluable` contradicts nothing.
   */
  readonly hardDisagreements: {
    readonly autoRejectedWhereLegacyApproved: number;
    readonly autoClearedWhereLegacyRejected: number;
  };
  readonly notEvaluable: number;
  /** Legacy intakes each rule would fire on today, as the engine reports them. */
  readonly ruleHits: readonly Tally[];
  /** Intakes queued from history, by rule, with the legacy outcome they carry (ADR-0005). */
  readonly itemsRaised: readonly HistoryItems[];
  /**
   * ADR-0012 item 5: an outcome spelling nobody could read counts as open for a minor's intake.
   * This is what that carve-out covers in this export.
   */
  readonly unreadableOutcomeCarveOut: {
    readonly unreadableOutcomes: number;
    readonly minorsAmongThem: number;
  };
}

export interface UnexpectedFinding {
  readonly finding: string;
  readonly numbers: Readonly<Record<string, number>>;
  /** Where the finding was established: a P-n / H-n section or the rule that records it. */
  readonly evidence: string;
  /** Why `EXPORT-NOTES.md` does not cover it. */
  readonly notCovered: string;
}

export interface ImportReport {
  readonly asOf: string;
  readonly importerVersion: string;
  readonly rulesetVersion: string;
  readonly whatCameIn: WhatCameIn;
  readonly whatWasCleaned: WhatWasCleaned;
  readonly whatWasQuarantined: WhatWasQuarantined;
  readonly rulesApplied: readonly Assumption[];
  readonly identity: Identity;
  readonly consent: Consent;
  readonly shadowEvaluation: ShadowEvaluationReport;
  readonly notInExportNotes: readonly UnexpectedFinding[];
}
