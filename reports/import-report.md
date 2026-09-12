# Import report

Wellis Intake, Part A: what the legacy export contains, what the importer changed, what it refused to change and what nobody warned us about.

This is a statement about **the export**, not about a run: it carries the inputs every number depends on and no run id and no clock, so two runs over one export produce byte-identical files and a diff of this file is a change in the data or in the rules. Every number is produced by `npm run import`, none is typed by hand.

| input | value |
| --- | --- |
| `--as-of` | `2026-09-08` |
| importer version | `1.0.0` |
| ruleset version | `v1` |

## What came in

| file | bytes | sha256 |
| --- | --- | --- |
| `patients.csv` | 337327 | `6aba831ad75a0cc0eea27fd0722a93998105375b529980fe66f470e9a5546e72` |
| `intakes.csv` | 275640 | `780799bb684f0f5375fe8df8f3ef4062a80ef532953612fa43a9ce88bc82a8c3` |
| `consents.jsonl` | 362091 | `b569f2441df3cd19287f984843bff31e979f192a49dd207c12e2abedd3e8931b` |

Every row is stored as exported before anything is interpreted (R-A8).

| stored | rows |
| --- | --- |
| `legacy_patients_raw` | 2466 |
| `legacy_intakes_raw` | 2917 |
| `legacy_consent_events_raw` | 2643 |
| patients (legacy rows) | 2466 |
| &nbsp;&nbsp;surviving after merges | 2438 |
| &nbsp;&nbsp;merged away, kept and still resolving | 28 |
| legacy ids resolving to a patient | 2466 |
| intakes | 2917 |
| &nbsp;&nbsp;orphans: no patient row in the export | 21 |
| consent events | 2643 |
| &nbsp;&nbsp;referencing a patient that does not exist | 0 |
| natural keys the export repeats with different values | 0 |
| rows whose source changed since an earlier run | 0 |

## What was cleaned

13856 normalisation records over 19 rule codes: one row per stored value that differs from the raw value, with the rule that changed it and the evidence that rule rests on (R-A7). A blanked value is a value we refused to guess; it keeps its raw form in the `legacy_*_raw` tables and has a review item of its own.

| rule | rows | of which blanked | fields | evidence |
| --- | --- | --- | --- | --- |
| `DATE_IMPOSSIBLE_TO_NULL` | 11 | 11 | dob 5, signup_date 3, submitted_at 3 | `{"profile":["P-4","P-13","P-18","P-35"]}` |
| `DATE_ORDER_FROM_SEPARATOR` | 1698 | — | dob 638, signup_date 647, submitted_at 413 | `{"hypothesis":"H-1","convention":{"9999-99-99":"Y-M-D","99-99-9999":"D-M-Y","99/99/9999":"M-D-Y"},"unambiguous":{"dob":1479,"signup_date":1499,"submitted_at":1804},"counterexamples":0}` |
| `EMAIL_INTERNAL_SPACE_TO_NULL` | 10 | 10 | email 10 | `{"profile":"P-3","internalSpace":10}` |
| `EMAIL_LOWERCASE` | 28 | — | email 28 | `{"profile":"P-3"}` |
| `EMAIL_PLACEHOLDER_TO_NULL` | 11 | 11 | email 11 | `{"profile":"P-3","placeholders":11}` |
| `IMPLAUSIBLE_TO_NULL` | 22 | 22 | height_cm 11, weight_kg 11 | `{"profile":["P-9","P-11","P-20","P-21"],"hypothesis":"H-3"}` |
| `NON_NUMERIC_TO_NULL` | 272 | 272 | alcohol_units_week 272 | `{"profile":"P-24"}` |
| `OUTCOME_OK_ASSUMED_APPROVED` | 441 | — | outcome 441 | `{"profile":"P-25","hypothesis":"H-4","inference":"OK appears in every year alongside approved; rejected and pending have their own spellings"}` |
| `PHONE_E164_NL_MOBILE` | 1259 | — | phone 1259 | `{"profile":"P-7","forms":["06-99999999","0699999999"]}` |
| `TIMESTAMP_ZONE_ASSUMED` | 2643 | — | at 2643 | `{"profile":"P-31","zone":"Europe/Amsterdam","inference":"every event between 07:00 and 22:59 local, none at night"}` |
| `VERSION_LABEL_ASSUMED_V2` | 394 | — | questionnaire_version 394 | `{"profile":"P-19","inference":"2.0 read as questionnaire v2"}` |
| `VOCAB_NONE_CONDITION` | 348 | — | condition_report 348 | `{"profile":"P-23"}` |
| `VOCAB_NONE_MEDICATION` | 815 | — | medication_report 815 | `{"profile":"P-22"}` |
| `VOCAB_OUTCOME` | 1836 | — | outcome 1836 | `{"profile":"P-25","hypothesis":"H-4"}` |
| `VOCAB_SEX` | 1976 | — | sex 1976 | `{"profile":"P-5","hypothesis":"H-4"}` |
| `VOCAB_STATUS` | 1917 | — | status 1917 | `{"profile":"P-12","hypothesis":"H-4","meaningLevel":{"cancelled":"churned","on hold":"paused","new":"prospect","lead":"prospect"}}` |
| `WEIGHT_LBS_TO_KG` | 55 | — | weight_kg 55 | `{"profile":["P-9","P-10"],"hypothesis":"H-2","factor":0.45359237}` |
| `WEIGHT_UNIT_MISSING_TO_NULL` | 18 | 18 | weight_kg 18 | `{"profile":"P-10","hypothesis":"H-2","rows":18}` |
| `WHITESPACE_TRIM` | 102 | — | email 30, full_name 72 | `{"profile":["P-2","P-3"]}` |

Legacy consent times are wall-clock values read as Europe/Amsterdam: 0 fall in the autumn hour that happens twice and 0 in the spring hour that does not exist.

## What was quarantined

336 review items: a decision the importer could not make safely, handed to a human with the context to make it (R-A10). A rule that would produce hundreds of identical items produces one vocabulary-level item instead; a row-level item is raised only where the consequence differs per row.

| type | scope | items |
| --- | --- | --- |
| `clinical_history` | row | 115 |
| `consent` | row | 83 |
| `data_quality` | row | 62 |
| `duplicate_intake` | row | 5 |
| `identity_conflict` | row | 42 |
| `orphan_intake` | row | 21 |
| `vocabulary` | vocabulary | 8 |

| rule | type | scope | items |
| --- | --- | --- | --- |
| `HISTORY_FLAG_CONDITION` | clinical_history | row | 15 |
| `HISTORY_GLP1_MEDICATION` | clinical_history | row | 42 |
| `HISTORY_MINOR_NOT_REJECTED` | clinical_history | row | 58 |
| `CONSENT_CONFLICT` | consent | row | 7 |
| `CONSENT_NO_RECORD_WHILE_ACTIVE` | consent | row | 57 |
| `CONSENT_REVOKED_WHILE_ACTIVE` | consent | row | 19 |
| `DATE_IMPOSSIBLE_TO_NULL` | data_quality | row | 8 |
| `DOB_READING_FLIPS_MINOR` | data_quality | row | 6 |
| `ELFPROEF` | data_quality | row | 17 |
| `EMAIL_INTERNAL_SPACE_TO_NULL` | data_quality | row | 10 |
| `EMAIL_PLACEHOLDER_TO_NULL` | data_quality | row | 11 |
| `IMPLAUSIBLE_TO_NULL` | data_quality | row | 10 |
| `SAME_DAY_INTAKES` | duplicate_intake | row | 5 |
| `IDENTITY_TIER_2` | identity_conflict | row | 3 |
| `IDENTITY_TIER_3` | identity_conflict | row | 39 |
| `ORPHAN` | orphan_intake | row | 21 |
| `BSN_RETENTION` | vocabulary | vocabulary | 1 |
| `CONSENT_EVENT_IN_THE_FUTURE` | vocabulary | vocabulary | 1 |
| `DATE_ORDER_FROM_SEPARATOR` | vocabulary | vocabulary | 1 |
| `NON_NUMERIC_TO_NULL` | vocabulary | vocabulary | 1 |
| `OUTCOME_OK_ASSUMED_APPROVED` | vocabulary | vocabulary | 1 |
| `VERSION_LABEL_ASSUMED_V2` | vocabulary | vocabulary | 1 |
| `WEIGHT_LBS_DO_NOT_RECONCILE` | vocabulary | vocabulary | 1 |
| `WEIGHT_UNIT_MISSING_TO_NULL` | vocabulary | vocabulary | 1 |

| status | items |
| --- | --- |
| `open` | 336 |

## Rules applied, and the assumptions under them

Deterministic conversions are in the table above. These are the readings the export does not state: each was tested against the whole export, each carries the count it changed, and each has a confirmation item in the queue, so a "no" identifies exactly which rows to remap (R-A22).

| assumption | rule | rows | evidence |
| --- | --- | --- | --- |
| The separator says the order: `9999-99-99` is Y-M-D, `99-99-9999` D-M-Y, `99/99/9999` M-D-Y | `DATE_ORDER_FROM_SEPARATOR` | 1698 | `{"hypothesis":"H-1","convention":{"9999-99-99":"Y-M-D","99-99-9999":"D-M-Y","99/99/9999":"M-D-Y"},"unambiguous":{"dob":1479,"signup_date":1499,"submitted_at":1804},"counterexamples":0}` |
| The outcome spelling `OK` means approved | `OUTCOME_OK_ASSUMED_APPROVED` | 441 | `{"profile":"P-25","hypothesis":"H-4","inference":"OK appears in every year alongside approved; rejected and pending have their own spellings"}` |
| The questionnaire label `2.0` means v2 | `VERSION_LABEL_ASSUMED_V2` | 394 | `{"profile":"P-19","inference":"2.0 read as questionnaire v2"}` |
| A weight with no unit is stored as null, never converted: reading it as pounds is a proposal on one vocabulary item, applied only by a human | `WEIGHT_UNIT_MISSING_TO_NULL` | 18 | `{"profile":"P-10","hypothesis":"H-2","rows":18}` |
| Legacy consent times are Europe/Amsterdam wall time, converted to an instant | `TIMESTAMP_ZONE_ASSUMED` | 2643 | `{"profile":"P-31","zone":"Europe/Amsterdam","inference":"every event between 07:00 and 22:59 local, none at night"}` |
| An intake weight is in kilograms: intakes.csv carries no unit column, and the values sit where the patient rows in `kg` sit | — | 2911 | `{"profile":["P-20","P-9"],"hypothesis":"H-2"}` |
| Signup weight and intake weight may legitimately differ; the divergence tolerance is derived from the `kg` rows and only a ratio outside it is a question | — | — | `{"tolerance":{"min":0.9,"max":1.1},"profile":"P-20","hypothesis":"H-2"}` |

## Identity: duplicate patient records

70 candidate groups, every one of them a pair. Only a group that is literally identical on identity and non-contradictory on everything else is merged by the importer; everything else is a decision for a human, shown side by side with no proposed winner.

| tier | groups | what the importer did |
| --- | --- | --- |
| 1: identical on identity | 28 | merged, with an audit entry each |
| 1: already decided by a human | 0 | left alone, counted |
| 2: same person, differing fields | 3 | review item, side by side |
| 3: shared key, contradicting | 39 | review item, marked a conflict |

| survivor chosen because | pairs |
| --- | --- |
| `survivor has the lower legacy id` | 19 |
| `survivor is the only row with intakes` | 9 |

A merge writes two things: `merged_into` on the loser and the alias rows that pointed at it. Nothing is deleted, every legacy id keeps resolving, and the fields a survivor took from its loser (0 in this export) carry per-field provenance in the audit entry, so every merge can be taken back by writing the same two things back.

## Consent

The log is evidence and is never touched; the state is what we act on. It is derived per patient and per consent type from the events in timestamp order — not in file order, which disagrees — with a revocation winning a tie, and a log whose first event is a revocation reading as `conflict` rather than as either of the two things it could mean.

| state, per surviving patient | patients |
| --- | --- |
| `conflict` | 7 |
| `granted` | 2091 |
| `no_record` | 51 |
| `revoked` | 269 |
| `unknown_pre_log` | 20 |

| state, per legacy row before merges | rows |
| --- | --- |
| `conflict` | 7 |
| `granted` | 2091 |
| `no_record` | 74 |
| `revoked` | 269 |
| `unknown_pre_log` | 25 |

Two things separate the two tables, and between them they account for it exactly. The merged-away rows take their own state with them (28: 14 `granted`, 10 `no_record`, 4 `revoked`), because a duplicate row is not a second person to chase for consent. And a merge hands the survivor its duplicate's events — a merge moves no event, and a patient's records are the union its membership returns — so some survivors change state:

| survivor state changed by a merge | patients |
| --- | --- |
| `no_record -> granted` | 9 |
| `no_record -> revoked` | 4 |
| `unknown_pre_log -> granted` | 5 |

That second table is the reason a duplicate matters here beyond tidiness: for those patients the consent record was on the row we were about to stop looking at.

| items raised, per surviving patient | items |
| --- | --- |
| `CONSENT_CONFLICT` | 7 |
| `CONSENT_NO_RECORD_WHILE_ACTIVE` | 57 |
| `CONSENT_REVOKED_WHILE_ACTIVE` | 19 |

| items the same rules raise per legacy row | items |
| --- | --- |
| `CONSENT_CONFLICT` | 7 |
| `CONSENT_NO_RECORD_WHILE_ACTIVE` | 73 |
| `CONSENT_REVOKED_WHILE_ACTIVE` | 19 |

### What the log says about the medical record

Both figures count intakes whose submission date the mapper could read, against the timestamps of that legacy row's own events, in Europe/Amsterdam days.

| finding | intakes |
| --- | --- |
| submitted before the calendar day of the first grant (68 patients) | 68 |
| submitted after a revocation with no later grant | 83 |

69 events are dated after `--as-of 2026-09-08` (3 granted, 66 revoked). Their states stand as derived: honouring a revocation that may be mis-timed costs a re-consent, ignoring a real one is a breach. One vocabulary item asks about the timestamps and lists every event.

## The ruleset against history (shadow evaluation)

Every one of the 2917 legacy intakes was evaluated with the ruleset the console would apply today, and **nothing was applied**: each intake keeps the state its legacy outcome gave it. Queueing those disagreements would be wrong — the doctor who approved a 2024 intake saw its BMI.

| engine outcome \ legacy outcome | approved | pending | rejected |
| --- | --- | --- | --- |
| `auto_cleared` | 1642 | 256 | 406 |
| `auto_flagged` | 222 | 38 | 71 |
| `auto_rejected` | 186 | 35 | 33 |
| `not_evaluable` | 18 | 3 | 7 |

**Hard disagreements** are two cells and only two: `auto_rejected` where the legacy outcome was approved (186) and `auto_cleared` where it was rejected (406). `auto_flagged` is never one: it means a human should look, and a human did. `not_evaluable` (28) is compared with nothing — the rules could not run, so they contradict no decision.

| rules that would fire on a legacy intake today | intakes |
| --- | --- |
| `age_below_minimum` | 70 |
| `bmi_band_without_condition` | 283 |
| `bmi_below_minimum` | 191 |
| `flag_condition` | 15 |
| `glp1_medication` | 42 |

Items are raised only where the legacy process could not see the problem — a medication or a condition buried in free text — or where the question is a legal one:

| rule | legacy outcome | intakes |
| --- | --- | --- |
| `HISTORY_FLAG_CONDITION` | approved | 10 |
| `HISTORY_FLAG_CONDITION` | pending | 2 |
| `HISTORY_FLAG_CONDITION` | rejected | 3 |
| `HISTORY_GLP1_MEDICATION` | approved | 28 |
| `HISTORY_GLP1_MEDICATION` | pending | 7 |
| `HISTORY_GLP1_MEDICATION` | rejected | 7 |
| `HISTORY_MINOR_NOT_REJECTED` | approved | 48 |
| `HISTORY_MINOR_NOT_REJECTED` | pending | 10 |

An outcome spelling nobody could read counts as open for a minor's intake, because nobody can say what the legacy process decided. This export has 0 such spellings, of which 0 belong to a minor: the guard covers nothing here and the count of queued minors is unaffected.

## Not in EXPORT-NOTES.md

What the previous team did not warn us about, in the order it matters (R-A23). Each line is a count over the loaded export, with the profile section that established it.

- `source` carries a sixth funnel the notes do not name: `referral` — patients **389**. _the notes list `typeform`, `website`, campaign tags and `import` and stop there_ (P-14)
- `OK` is not a spelling of approved but an inference over medical decisions; it has its own rule code and a confirmation item, so a "no" identifies every row to remap — intakes **441**. _the notes say outcomes are "spelled many ways", which `OK` is not_ (P-25)
- Intakes with no questionnaire label at all: the ruleset that evaluated them is not recorded anywhere, and `2.0` sits beside `v2` with nothing to tell them apart — intakes with no label **410**, intakes labelled 2 point 0 **394**. _the notes say only that "labelling discipline varied"_ (P-19)
- Three patient records are shifted about 36 years into the future, consistently across all three files; their dates of birth are normal, so it is the row that moved, not a digit — patient rows **3**, intake rows **3**, consent events **3**. _the notes warn about date *ordering*, not about dates that are impossible_ (P-13, P-18, P-31)
- Consent events dated after the run's --as-of (2026-09-08), revocations included — events **69**, granted **3**, revoked **66**. _the notes question the log only *before* 2023_ (P-31)
- Valid BSNs carried by more than one patient row: an identity collision on a national identifier, not a formatting problem — bsn values **30**, patients **60**. _the notes say BSNs were "never validated", which is a claim about their shape_ (P-6, P-34)
- The weights left without a unit are not a leftover: read as kilograms most are outside any plausible adult range, read as pounds they are ordinary. Stored null, asked once — patients **18**, above 200 as kilograms **11**. _the notes promise the unit was backfilled "where obvious" and say no more_ (P-10, H-2)
- Free-text history names contraindications on intakes the legacy process approved: GLP-1 medication, and thyroid cancer or pancreatitis — glp 1 intakes **42**, glp 1 approved **28**, flag condition intakes **15**, flag condition approved **10**. _the notes describe both columns as free text that was never normalised, and say nothing about what is in them_ (P-22, P-23)
- Intakes from patients under 18 at submission, most of them not rejected — a legal question rather than a disagreement about the rules — intakes **70**, approved or pending **58**, rejected **12**. _the notes say nothing about age_ (P-4, H-1)
- One patient submitting two intakes on one day, which no rule in the export forbids — pairs **5**. _the notes warn about people signing up twice, which is a duplicate *patient*, not a duplicate submission_ (P-27)
- The consent log is not in time order: read as an append-only file, last line wins, it reports a different state for these patients than their timestamps do — patients **131**. _the notes call the file append-only, which is what makes the order look safe_ (P-33)
- Patients with no consent event at all, and `v1` consent-text versions still appearing after the `v2` cut-over: silence before 2023 cannot be told from a lost record — patients with no record **99**, events before 2023 **477**, patients with no event since 2023 **432**, events still labelled v1 after 2024 **64**. _the notes say the log is "believed complete from 2023 onwards" and leave the rest open_ (P-30, P-31, P-32)
- A reviewer note saying "twijfel, toch akkoord" ("doubt, approved anyway") on intakes whose recorded outcome is a rejection: the note and the outcome disagree — intakes **73**. _the notes describe `reviewer_note` as free text and nothing more_ (P-26)
