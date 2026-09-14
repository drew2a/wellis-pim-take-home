# What the care team does in the console — the decision record for Part C

Two jobs, one app, one queue. **Ops** handles data, identity and consent; **Doctor** handles
clinical decisions. That is a division of labour between colleagues, **not a permission the app
enforces**: since ADR-0027 a reviewer has no role, and every action below is open to whoever is
signed in. The headings say who normally does what, and the filters are what make that practical.

Every action below writes an audit entry with the reviewer as actor and a required note. Nothing
is ever deleted.

## The queue — everyone

One screen, one table. Every row is one thing to do: a review item or an intake.
- Columns: type · title · patient · age (created_at, or the draft audit entry for an intake) ·
  status.
- Filters: **type** (identity_conflict, orphan_intake, duplicate_intake, consent, data_quality,
  vocabulary, clinical_history, and intakes by state: auto_flagged, auto_rejected, auto_cleared,
  in_review, legacy_pending, legacy_approved, legacy_rejected), **age** (today / this week /
  older), **status** (open / resolved / dismissed; default open). Sort: oldest first.
- Counts per type visible without clicking. Every state of ADR-0014 is reachable here.
- Default view: **everything waiting for a person** — open items, and intakes in auto_cleared,
  auto_flagged, auto_rejected and in_review. auto_cleared is the brief's "clear for doctor review",
  which is a doctor's inbox and not a finished case; an auto_rejected intake nobody opens is a
  machine taking the final decision on a person's eligibility with no human in the loop, which is
  why ADR-0014 keeps the auto_rejected → in_review edge. Out of the default and one filter click
  away: draft (the patient is still filling it in), submitted (transient inside one request),
  approved and rejected (decided), and every legacy_* state (history).

## Ops — actions

1. **Resolve a vocabulary item** (8). Example: "Confirm the date convention: dash = D-M-Y,
   slash = M-D-Y (evidence: 1479 unambiguous values, 0 counterexamples)". Sees the rule, the
   evidence, the list of affected rows. Confirms or rejects with a note. For "18 unit-less
   weights read as pounds" sees each row with both readings and both BMIs and can exclude rows
   before applying. Applying writes one audit entry per changed row.
2. **Resolve an identity conflict** (42). Example: two rows "Bram Nair" / "Braam Nair", same
   dob, different emails, matched on bsn. Sees both rows side by side, differing fields
   highlighted, which keys matched, each row's intake count and consent state, the tier.
   Actions: **merge** — picks the survivor, per field picks left / right / edits, note; the
   merge really happens (alias repointed, merged_into set, consent state recomputed, audit with
   field provenance). **Not the same person** — dismiss with note. **Leave open.** bsn masked,
   reveal is audited.
3. **Resolve an orphan intake** (21). Example: intake INT-7412 references a legacy id that
   exists nowhere. No candidate patients are shown: the intake carries no identity field, so
   there is nothing to match on (ADR-0029). Actions: **attach** to a patient (search by name /
   email / legacy id, note) or **leave unresolved**. No "create patient", for the same reason.
4. **Resolve a same-day pair** (5). Example: two intakes for one patient on 2024-04-12, one
   "in review", one "goedgekeurd". Both side by side; marks one as the record of note with a
   note; both rows stay.
5. **Work a consent item** (83). Example: patient active, last event revoked 2025-03-02. Sees the
   consent timeline. Actions: **resolve** with a note describing what was done outside the
   system (patient contacted, consent re-obtained on paper, processing paused) or **dismiss**
   with a note. For the 7 conflicts: **set the state** (granted / revoked) with a note.
6. **Resolve a data_quality item** (62). Example: weight 7.8 kg, proposal "78 kg (decimal
   shift)". Actions: **accept the proposal**, **enter a value**, or **dismiss** — all with a
   note; accepted values go through the resolution path and appear in the patient's timeline.
7. **Open a patient** from any item (see below).

## Doctor — actions (the clinical half of the same queue)

8. **Review a new intake** (auto_flagged first; auto_cleared and auto_rejected sit beside it in
   the default view, not behind a filter). Example: intake from today, "flagged: current GLP-1
   medication (declared by patient)". Sees the answers as given (structured fields, free text as
   typed), the engine's evaluation: outcome, every reason line, the inputs it saw (age, BMI,
   matched terms), ruleset version.
   Actions: **claim** → in_review with the reviewer as actor (a second reviewer sees "claimed by
   Dr Vermeer" and cannot claim); **approve** / **reject** with a note (approve of an under-18
   intake is refused with the reason shown, for everyone); **open the patient**.
9. **Reopen a legacy_pending intake** (332, via the filter). Example: "wacht op arts" from
   2025-11. Claim → in_review, then approve/reject as above. legacy_approved / legacy_rejected
   have no door; their disagreements are clinical_history items.
10. **Work a clinical_history item** (115). Example: legacy intake approved 2024-07, meds_current
    "Ozempic 0,5 mg" — "flagged: current GLP-1 medication (Ozempic 0,5 mg)". Sees the legacy
    intake, the reason, the legacy outcome, and **the patient now**: status, consent state and
    their age on the import's `--as-of`, which is what says whether the case is urgent or
    archival. Actions: **resolve** with a note (patient contacted, care plan adjusted, no action
    needed; for a minor approval: guardian contacted, participation paused, an adult now) or
    **dismiss** with a note. The historical outcome never changes.

## Patient detail — everyone

Header: canonical record (bsn masked, reveal audited), status, consent state per type, the
legacy rows it was built from and any rows merged into it. Sections: **intakes** (state, outcome,
shadow verdict for legacy ones), **open items** for this patient, **audit timeline** newest
first — import run and every normalisation record (field, from → to, rule), merges with field
provenance, transitions with actor and reason, item resolutions with notes — and **raw rows** as
exported, read-only. "How the record came to look the way it does" is this page. Records are
resolved through the membership function of ADR-0008, never the copied patient_id.

## Deliberately not built (README scope cuts)
- Unmerge UI (repository function exists; via API only).
- Sorting beyond age; saved filters; bulk actions except the vocabulary items' row exclusion.
- Real authentication: reviewer picked from the seeded list plus a shared console secret. No
  permissions either, and deliberately so — a gate behind a shared secret refuses nobody
  (ADR-0027). SSO is what a real deployment plugs in, and permissions come with it.
