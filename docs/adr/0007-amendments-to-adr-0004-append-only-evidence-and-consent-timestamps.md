# ADR-0007: Amendments to ADR-0004: append-only evidence by trigger, consent timestamps as instants

- **Status:** proposed
- **Date:** 2026-09-10
- **Deciders:** Andrei Andreev
- **Requirements:** R-A7, R-A8, R-A15, R-B20, R-B21 · **Amends:** ADR-0004 (the audit_entries
  lock and the open question on `consent_events.at`)

## Context and problem statement

Two points of ADR-0004 could only be settled when the tables were written. First, ADR-0004 makes
`audit_entries` append-only by revoking `UPDATE` and `DELETE` from "the application role". In
production the app reaches Postgres through the Supabase pooler, which authenticates one role per
connection string: a role split means a second role created by migration, a password that cannot
live in a committed migration, and a second production URL. Second, ADR-0004 deferred the column
type of `consent_events.at`, because legacy timestamps carry no zone (data-profile P-31) while
new-flow events will. Both were decided on the `feature/schema` branch; this ADR records them.
Accepted ADRs are immutable, so ADR-0004 is amended here rather than edited.

## Decision drivers

- Audit is append-only (R-B21); raw rows are byte-faithful and never rewritten (R-A8); a
  normalisation record is evidence of a change and must outlive it (R-A7).
- The guarantee must hold in every environment, including the compose database, where the only
  user is a superuser, and Supabase, where the pooler gives one role per URL.
- One column holds one kind of time; legacy and new-flow consent events are ordered together by
  the derivation of ADR-0005.
- KISS: one deployable, one connection string per purpose, no manual provisioning steps.

## Amendment 1: the append-only lock is a trigger, on every evidence table

**Replaces** in ADR-0004, `audit_entries`: "`UPDATE` and `DELETE` are revoked from the application
role", and in Confirmation: "Attempting `UPDATE audit_entries` as the application role fails".

### Considered options

1. **Trigger.** One plpgsql function raising an exception, attached as a statement-level `BEFORE
   UPDATE OR DELETE OR TRUNCATE` trigger.
2. **Role split.** A second role without `UPDATE`/`DELETE` on `audit_entries`, used by the app;
   the owner role keeps full rights for migrations.

### Decision outcome

Chosen option: **Trigger**, extended from `audit_entries` to every table ADR-0004 says is never
updated: `audit_entries`, `consent_events`, `normalisation_records`, `legacy_patients_raw`,
`legacy_intakes_raw`, `legacy_consent_events_raw`. The rule in one sentence: **what is evidence is
immutable in the database; what is derived or decided is not.** Canonical tables are rewritten
from raw on re-run, `consent_states` is recomputed, `review_items` is what the resolution path
changes; all three stay writable.

Statement-level rather than row-level so that an attempt matching no row is rejected too, and
`TRUNCATE` is covered by the same trigger. Migration `drizzle/0001_append_only_evidence.sql`.

### Pros and cons of the options

**Trigger**

- Good: holds for every role in every environment; one migration, no secrets, no second URL.
- Good: the compose superuser is subject to it, so the integration test proves the real lock.
- Bad: the table owner can `DROP TRIGGER` or `ALTER TABLE ... DISABLE TRIGGER`. Accepted: the
  same owner could `GRANT` the privilege back under option 2, so the split protects against
  nothing the trigger does not.

**Role split**

- Good: matches the wording of ADR-0004 and the textbook least-privilege model.
- Bad: a login role needs a password, so provisioning has a manual step; a second connection
  string in `.env`, CI and Vercel; default privileges to maintain for every future table; a
  second local role, because the compose superuser bypasses grants.

### Consequences

- The importer's idempotent raw load is `INSERT ... ON CONFLICT DO NOTHING`, never an upsert; a
  changed source row raises a review item (ADR-0004) and cannot overwrite the raw row.
- A merge repoints `patient_legacy_ids`, never `consent_events.patient_id`; the join through the
  alias table is the only correct one, as ADR-0004 already requires.
- Correcting a wrong evidence row means inserting a correcting row and recording why in
  `audit_entries`, never editing in place.

## Amendment 2: `consent_events.at` is `timestamptz`

**Replaces** the section "Open question carried into implementation" of ADR-0004.

### Considered options

1. `timestamptz`; legacy wall-clock values converted via `Europe/Amsterdam` at import, with a
   `TIMESTAMP_ZONE_ASSUMED` normalisation record per row.
2. `timestamp` without zone for all events; new-flow events converted to Dutch wall time.

### Decision outcome

Chosen option: **`timestamptz`**. New-flow events carry a real instant, and the ADR-0005
derivation orders legacy and new events in one comparison, so the column must hold instants.
Converting a zoneless legacy value into an instant is a guess with evidence (the hour histogram in
`docs/findings.md`, consents, says local Dutch time), and it is recorded per row as R-A7 requires.
Option 2 converts in the lossy direction: a new-flow instant becomes a wall time that is
ambiguous once a year.

Obligations for the importer branch:

- Convert every legacy `at` via `Europe/Amsterdam`; write one `TIMESTAMP_ZONE_ASSUMED` record per
  event, `from_value` the raw string, `to_value` the ISO instant.
- Count the events whose wall time falls in the autumn fall-back hour, where the conversion is
  ambiguous, and print the count in the import report. The histogram (every event between 07:00
  and 22:59, `docs/findings.md`) predicts zero;
  the count is produced by code, not assumed (`CLAUDE.md` §4).

### Consequences

- The raw string survives untouched in `legacy_consent_events_raw.at`; the instant is derived.
- Every other timestamp column in the schema is `timestamptz` as well; there is one kind of time.

## Confirmation

- `src/db/append-only.integration.test.ts`: for each of the six tables, `INSERT` succeeds and
  `UPDATE`, `DELETE` and `TRUNCATE` are rejected with the trigger's message, the row surviving.
- `src/db/schema.ts`: `consentEvents.at` is `timestamp with time zone`, not null.
- Importer branch: `COUNT(*)` of `TIMESTAMP_ZONE_ASSUMED` records equals the raw consent row count
  (2643 for this export), and the report carries the fall-back-hour count.

## More information

- ADR-0004 (the tables amended here), ADR-0005 (consent derivation), ADR-0003 (constraints in the
  database, tests against a real Postgres).
- `docs/profile/data-profile.md` P-29 to P-31; `docs/findings.md`, consents.
