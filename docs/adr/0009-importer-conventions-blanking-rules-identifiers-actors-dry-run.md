# ADR-0009: Importer conventions: blanking rules, entity identifiers, system actors, dry runs

- **Status:** proposed
- **Date:** 2026-09-11
- **Deciders:** Andrei Andreev
- **Requirements:** R-A7, R-A9, R-A10, R-A14, R-A15, R-A17, R-A22, R-B20 · **Amends:** ADR-0004
  (`import_runs` columns), ADR-0005 (rule codes for values the mapper blanks), ADR-0007 (which
  instant an ambiguous consent wall time becomes)

## Context and problem statement

The importer branch (`feature/importer-load`) implements the mapping table of ADR-0005 and the
tables of ADR-0004. Eight points surfaced that no accepted ADR settles and that the console,
detector and Part B branches would otherwise settle differently: ADR-0008 assumes a rule that
blanks a value writes a normalisation record with `to_value` null, but ADR-0005 names no such
rule; ADR-0004 says an implausible weight is stored null while ADR-0005 says detectors never
write a canonical value; the evidence tables need one convention for `entity_id`; the
human-owned-field rule needs a definition of "human actor"; `import_runs` has no column for the
`--as-of` date the report's "future" counts depend on; a dry run must both write nothing and be
on record; ADR-0007 asks for the fall-back-hour count but not for the instant chosen; and the
consent `action` enum has no `unknown` value for an unseen spelling. Each is small; together they
are the importer's contract with the branches that follow, so they are recorded once, here.

## Decision drivers

- No value changes without a record, blanking included (R-A7, `CLAUDE.md` §5).
- The mapper never guesses; a deterministic rule read from `rules/v1.json` is not a guess
  (ADR-0005, R-A9, R-A10).
- A nulled value is not a resolved value: every blanking that needs a human gets a review item,
  on this branch or on a named later one.
- One convention per question, stated before a second branch invents another (KISS).
- Two runs are identical in every table but `import_runs` (R-A15, R-A16); a dry run writes no
  data (ADR-0004) yet is a run.

## Decision outcome

| # | Question | Decision |
| --- | --- | --- |
| 1 | Rule codes for values the mapper blanks | Every stored null whose raw value is non-empty has a normalisation record with `to_value` null and one of: `DATE_IMPOSSIBLE_TO_NULL` (dob after `--as-of` or giving an age above 100 at signup; `signup_date` or `submitted_at` after `--as-of`), `DATE_UNREADABLE_TO_NULL` (not one of the three shapes), `EMAIL_PLACEHOLDER_TO_NULL`, `EMAIL_INTERNAL_SPACE_TO_NULL`, `WEIGHT_UNIT_MISSING_TO_NULL`, `PHONE_UNPARSED_TO_NULL`, `BSN_MALFORMED_TO_NULL` (not nine digits, which the `CHECK` could not store; `bsn_check` is `absent`), `IMPLAUSIBLE_TO_NULL`, `NON_NUMERIC_TO_NULL` (ADR-0005 names it for `alcohol_units_week`; it covers any numeric column whose value is not a number of the column's shape, weight and height included), `VOCAB_UNKNOWN` (closed vocabulary value not in the mapping table, `weight_unit` included; canonical `unknown` where the enum has it, null otherwise). Records chain: a slash date in 2049 gets `DATE_ORDER_FROM_SEPARATOR` from the raw string to the read date, then `DATE_IMPOSSIBLE_TO_NULL` from the read date to null, so the ADR-0005 count of 638 holds. An empty raw value maps to null with no record: empty is empty. The age check runs only when the signup date itself is possible: ADR-0005's "6 impossible dates (5 future, 1 above 100)" counted `recuSs76Rr161XtAA`, born 1958 with a signup date in 2062; the signup is what is impossible and has its own item, so the dob is kept and the count is 5. |
| 2 | Who nulls an implausible weight or height | The **mapper**, with `IMPLAUSIBLE_TO_NULL`, reading the bounds from `rules/v1.json` (weight 30 to 300 kg, height 100 to 230 cm). This is a deterministic rule, not a guess, so it is layer 1 of ADR-0005; the detector stays layer 2 and never writes a canonical value. **The detectors branch owes the matching `data_quality` review items with the decimal-shift proposal** (ADR-0005, plausibility row), one per patient, covering patient and intake values, so the nulled values do not stay without a decision. On this export the mapper blanks 5 patient weights, 5 patient heights, 6 intake weights and 6 intake heights. |
| 3 | `entity_id` in the evidence tables | `normalisation_records`: the **natural key** of the legacy row, with `entity_type` `legacy_patient` (`legacy_id`), `legacy_intake` (`intake_id`) or `legacy_consent_event` (`line_no`). `audit_entries`: the **canonical uuid**, with `entity_type` `patient` or `intake`, because transitions, human decisions and the console act on canonical rows. New-flow entities have no natural key, so a normalisation record written outside the importer (should the intake form ever normalise a value) uses the canonical uuid with `entity_type` `patient` or `intake`; the type names distinguish the two conventions and Part B introduces no third. The human-owned-field check (ADR-0004) reads `audit_entries` by canonical uuid. |
| 4 | Which actors are human | One exported set `SYSTEM_ACTORS` in `src/import/actors.ts`, today `legacy import` and `importer`. Part B adds the engine's actor for automatic transitions there and nowhere else. Any actor not in the set is human, and a field it names in `audit_entries.changes` is human-owned. A transition by a human (`from_state` or `to_state` set) makes `state` human-owned as well, otherwise a re-run would return a reopened legacy intake to its legacy state. |
| 5 | `import_runs.as_of` | Added (`date`, not null) by migration 0002. Every "future" judgement of a run (impossible dates, future-dated consent events) is relative to this date, never to the wall clock, so a run is reproducible from its row (`CLAUDE.md` §5, every number produced by code). |
| 6 | Dry run | The whole import runs in one transaction. With `--dry-run` that transaction is rolled back after the counts are printed; the `import_runs` row (`dry_run = true`, `report_path` null) is written in its own committed transaction beforehand and its `finished_at` set afterwards, so the run is on record and the data tables are untouched. A run that throws leaves nothing but its `import_runs` row with `finished_at` null. |
| 7 | Ambiguous and non-existent consent wall times | Conversion via `Europe/Amsterdam` (ADR-0007). A wall time in the autumn fall-back hour has two instants; the importer takes the **earlier** one (summer offset, the first occurrence) and records `ambiguous: true` in the record's evidence. A wall time in the spring gap has none; the importer takes the instant one hour later (the offset in force before the transition) and records `nonexistent: true`. Both counts are printed by the CLI; the hour histogram predicts zero for both. |
| 8 | Unseen consent `action` or `type` | `consent_events.action` is an enum without `unknown` and the event cannot be stored without one. The raw row is stored (it always is), no canonical event is written, and one vocabulary item per unseen value is raised with the affected line numbers in its payload; the consent-state derivation of the detectors branch treats the patient's events as incomplete until the item is resolved. An unseen `type` is stored as exported (text column) with the same one item; the state is per type and a new type is not folded into `data_processing`. Likewise an intake whose `outcome` spelling is unseen maps to `unknown` and sits in `legacy_pending`, the one non-terminal legacy state, until its vocabulary item is resolved; its audit entry names the raw outcome. Zero rows in this export. |

### Consequences

- Good: every null in a canonical row is explained by exactly one of three things: the raw value
  was empty, a record with one of the codes above, or the schema (a new-flow row). The report's
  "rules applied" lists the blanking codes like any other rule.
- Good: the mapper and the detectors keep the ADR-0005 layering; the plausibility bounds have one
  definition and one reader per layer.
- Bad: between this branch and the detectors branch, 22 nulled weights and heights have no review
  item. Accepted for the duration of one branch; item 2 records the debt and the detectors
  branch's R-A16 test asserts the items exist.
- Bad: two `entity_id` conventions in one database. Accepted: they live in different tables with
  different questions ("what did the export say" versus "what happened to this patient"), and
  `entity_type` names which one applies on every row.
- Neutral: migration 0002 is one column; `import_runs` rows written before it do not exist.

### Confirmation

- Unit tests per blanking code, including the chained date case and empty-is-empty.
- Integration test: after import, every canonical null with a non-empty raw value has a record
  with one of the codes in item 1; `IMPLAUSIBLE_TO_NULL` counts are 5, 5, 6, 6 by table and field.
- `SYSTEM_ACTORS` is the only actor list the importer and the resolution path import.
- Integration test: a dry run leaves one more `import_runs` row and no other count changed.
- The CLI prints the fall-back and spring-gap counts; both are 0 for this export.

## More information

- ADR-0004 (tables, human-owned fields), ADR-0005 (mapping table, layers), ADR-0006 (orphans),
  ADR-0007 (consent instants), ADR-0008 (`to_value` in the dedupe key, provenance columns).
- `docs/findings.md`: dob, email, phone, weight and weight_unit, height_cm, consents.
