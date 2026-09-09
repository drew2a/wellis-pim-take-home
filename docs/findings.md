# Findings per column

What each column of `legacy_export/` contains, what could go wrong when we map it, and what we
agreed to do about it. Built one column at a time in discussion; the evidence is in
`docs/data-profile.md` (`P-n` sections, `npm run profile`) and `docs/data-hypotheses.md`
(`H-n` sections, `npm run profile:hypotheses`). Numbers here are copied from those two generated
files and nowhere else. Extra one-off checks quote their shell command.

Each column has three parts:

- **Facts**: what the export shows, with evidence.
- **Possible warnings**: what could go wrong in the importer or downstream if the column is taken
  at face value.
- **Agreed**: the outcome of the discussion. Empty until discussed. Decisions that shape the
  schema or the auto-fix / review boundary are then written up as ADRs and referenced here.

Vocabulary follows `CLAUDE.md` §6: a *normalisation record* is an automatic, explainable change;
a *review item* is a decision handed to a human.

---

## patients.csv

### legacy_id

**Facts** (P-1, P-17, P-32)

| fact | value |
|---|---|
| rows / empty / distinct | 2466 / 0 / 2466 |
| length | 17 characters, every row |
| prefix | `rec` on every row, then 14 characters |
| character classes after the prefix | lower+upper+digit 2227, lower+upper 238, lower+digit 1 (`rech80qisbw8yubit`) |
| leading or trailing whitespace | 0 rows |
| case-insensitive collisions | 0 |
| referenced by intakes.csv | 2896 of 2917 intakes resolve; 21 do not (21 distinct ids); 447 patients have no intake |
| referenced by consents.jsonl | 2643 of 2643 events resolve; 99 patients have no event |
| orphan intake ids matching a patient id case-insensitively | 0 |
| orphan intake ids present in consents.jsonl | 0 |

The all-lowercase id `rech80qisbw8yubit` is a real patient: it has 3 intakes and 1 consent event.

```sh
tail -n +2 legacy_export/patients.csv | cut -d, -f1 | tr 'A-Z' 'a-z' | sort | uniq -d | wc -l   # 0
```

The shape (`rec` + 14 alphanumerics) is the record-id format of a well-known spreadsheet-database
tool. Hypothesis only; the export does not say so.

**Possible warnings**

1. Uniqueness holds in this file but nothing in the source enforced it. The importer must enforce
   it in the database (unique constraint on the raw id), not assume it.
2. Ids are case-sensitive base-62 strings. Any normalisation (trim, case-fold) would be wrong and
   could create collisions in a later export; the id must be stored byte-for-byte and compared
   byte-for-byte.
3. 21 intakes point at ids that exist nowhere else. They are not case variants and not in the
   consent log, so they cannot be repaired from this export. They need a home that keeps the
   intake and makes the missing patient visible.
4. The id is the join key for two other files. Once two patient rows are merged into one patient,
   both ids must keep resolving, or intakes and consents of the losing row silently detach.
5. Ids from a bulk load nobody remembers (`source = import`, 417 rows) share the format with the
   rest, so the format cannot be used to tell provenance.

**Agreed** (2026-09-09)

Store as-is, unique, opaque. No normalisation of any kind. Every legacy_id keeps resolving to
exactly one patient forever, also after a merge, via an alias table. Orphan intakes are stored
and get a review item each; how they attach to a patient is decided under
`intakes.legacy_patient_id`.

### full_name

**Facts** (P-2, P-34, H-5)

| fact | value |
|---|---|
| rows / empty / distinct raw / distinct folded | 2466 / 0 / 1655 / 1614 |
| trailing whitespace | 72 rows (all trailing; 0 leading; 0 double spaces inside) |
| digits, diacritics, ALL CAPS, all lowercase | 0 rows each |
| characters other than letters and space | only `-`, on 5 rows |
| tokens per name | 2 tokens 1911, 3 tokens 460, 4 tokens 95 |
| lowercase Dutch particles (`de`, `van`, `den`, `der`, ...) | 495 rows |
| exact duplicate names | 598 groups, 1409 rows |
| duplicate names after folding | 618 groups, 1470 rows; 603 of the groups span more than one email |
| same folded name and same dob (H-1 date reading) | 31 groups, 62 rows |

The 5 hyphenated names all follow one pattern, first name plus its own initial, and every one has a
plain twin row with the same date of birth and the same phone or bsn:

| variant | plain twin | shared |
|---|---|---|
| `Luuk-L Dijkstra` | `Luuk Dijkstra` | dob (two formats), bsn, phone |
| `Emma-E Visser` | `Emma Visser` | dob, bsn, phone |
| `Thijs-T Benali` | `Thijs Benali` | dob (two formats), phone |
| `Fatima-F de Wit` | `Fatima de Wit` | dob, bsn |
| `Lisa-L Jones` | `Lisa Jones` | dob (two formats), phone |

A doubled-letter variant also exists: `Braam Nair` shares bsn and dob with `Bram Nair` (H-5).

```sh
tail -n +2 legacy_export/patients.csv | awk -F, "{print \$2}" | grep -c " $"                 # 72
tail -n +2 legacy_export/patients.csv | awk -F, "{print \$2}" | grep -cE "^[A-Za-z]+-[A-Z] "  # 5
```

**Possible warnings**

1. Trailing spaces on 72 rows break exact matching and sorting. Trimming is safe and
   deterministic, but it is still a change to a stored value and needs a normalisation record.
2. Casing and particles are consistent (`Sem de Boer`, not `Sem De Boer`), so there is nothing to
   "fix" there. Any title-casing would be a change without evidence and must not happen.
3. The name pool is small: 618 folded names cover 1470 rows and 603 of those groups span different
   emails. A name alone is not identity and must never merge anything, not even as a tie-breaker.
4. Name *variants* (`Luuk-L`, `Braam`) are a signature of "signed up again with a different
   email". They are invisible to exact and folded matching and only surface through another key
   (dob, phone, bsn). Duplicate detection therefore has to start from those keys, not from the
   name.
5. The export has no split into given name and family name and no consistent particle handling.
   Splitting is guesswork and gains nothing for Part A; the new intake form (Part B) can collect
   structured names if wanted.

**Agreed** (2026-09-09)

Trim trailing whitespace with a normalisation record (rule `whitespace-trim`, 72 rows). Store the
trimmed value as typed otherwise: one field, no split, no casing changes. Never use the name to
merge. Folded name enters duplicate-candidate detection only as a secondary signal next to dob,
phone and bsn; name variants of the kind found here are what a reviewer sees side by side in a
conflict.

### email

**Facts** (P-3, P-34, H-5)

| fact | value |
|---|---|
| rows / empty / distinct raw / distinct folded | 2466 / 0 / 2447 / 2419 |
| leading whitespace / trailing whitespace | 18 rows / 12 rows (30 total) |
| contains uppercase | 28 rows, of which 21 are the whole address in capitals (`SEM.DEBOER@YAHOO.COM`) |
| whitespace inside the address | 10 rows, all of the form `local @domain` |
| fails the syntax check | 16 distinct values on 21 rows: the 10 above plus `n.v.t.` 4, `x` 3, `-` 1, `none` 1, `info@` 1, `@gmail.com` 1 |
| domains | 9 real domains, all consumer providers (`protonmail.com` 287 ... `outlook.com` 239), plus 1 row with no domain |
| plus-addressing | 0 rows |
| duplicate emails, exact | 16 groups, 35 rows |
| duplicate emails after folding | 44 groups, 91 rows (includes the junk groups `n.v.t.` x4 and `x` x3) |
| local part on more than one domain | 547 local parts |
| local part ending in `x` | 24 rows; 6 of them sit in the duplicate groups of H-5 (`fleur.degrootx`, `emily.dewitx`, `wei.vosx`, `bram.nairx`, `luuk.dijkstrax`, `emma.visserx`) |
| local part ending in a digit | 109 rows |

```sh
tail -n +2 legacy_export/patients.csv | awk -F, "{print \$3}" | grep -c "^ "                    # 18
tail -n +2 legacy_export/patients.csv | awk -F, "{print \$3}" | grep -cE "^[A-Z0-9.@]+$"        # 21
tail -n +2 legacy_export/patients.csv | awk -F, "{print \$3}" | grep -cE "^[^ @]+ @[^ @]+$"     # 10
```

**Possible warnings**

1. EXPORT-NOTES.md says one automation used email as a login. As exported it is not comparable:
   whitespace, case and a stray space before `@` split addresses that are the same mailbox. The
   comparison key has to be normalised (trim, lowercase, drop internal whitespace) or duplicate
   detection misses exactly the cases the ops team described.
2. Normalising the *stored* value is a different question from normalising the *comparison key*.
   Lowercasing the domain is always safe; lowercasing the local part is technically not (RFC 5321)
   but universally so in practice for these 9 providers. Removing the internal space is an
   inference: 10 of 10 cases are `local @domain` with a known provider domain, no counterexample.
3. 11 rows carry placeholders, not addresses (`x`, `-`, `n.v.t.`, `none`, `info@`,
   `@gmail.com`). Storing them as emails poisons duplicate detection (`n.v.t.` already forms a
   4-row "duplicate" group) and any future mailing. They are missing values that were typed to
   get past a required field.
4. Same email on different rows (44 folded groups) is the strongest single duplicate signal in the
   file, but it is not proof of one person: shared family addresses exist in real data, and here
   28 of the 31 name+dob groups share an email while 16 email groups have different names.
5. The `x` and digit suffixes on the local part (`bram.nairx`, `emily.dewit1`) are how people
   made a "new" address to retry the intake. They defeat exact matching on purpose and are only
   caught through dob, phone or bsn.
6. Only consumer domains appear, so there is no employer or clinic address that would hint at a
   staff test account. `info@` is the one exception and it is incomplete.

**Agreed** (2026-09-09)

Canonical email = trimmed and lowercased, each step its own normalisation record (rules
`whitespace-trim` 30 rows, `email-lowercase` 28 rows). Lowercasing the local part is accepted.
The 10 addresses with an internal space are **not** changed automatically: canonical email stays
null, and the row gets a review item that carries a *proposed fix* (the address with the space
removed) which the operator applies with one action or rejects. This introduces a general
mechanism: a review item MAY carry a proposed value; it is applied only with operator consent
and is then recorded as a human decision, not as a normalisation. The 11 placeholder values
become canonical null with a per-row review item "email missing, placeholder typed" and no
proposed fix. Shared canonical email between rows creates a duplicate-candidate conflict, never
a merge. No validation beyond the syntax check.

### dob

**Facts** (P-4, P-35, H-1, H-5)

| fact | value |
|---|---|
| rows / empty / distinct | 2466 / 0 / 2350 |
| shapes | `9999-99-99` 1828, `99-99-9999` 328, `99/99/9999` 310; nothing else |
| unambiguous values (a part above 12) | dash shape: 207 day-first, 0 month-first; slash shape: 0 day-first, 154 month-first |
| reading rule under test (H-1) | ISO = Y-M-D, dash = D-M-Y, slash = M-D-Y: 1479 unambiguous values, 0 counterexamples, 0 unreadable |
| same rule on signup_date and submitted_at | 0 counterexamples there either; under it 0 intakes predate their patient's signup |
| non-ISO shapes by signup year | present 2022, 2023, 2024; absent 2025, 2026 (P-36) |
| birth decades | 1950s 95, 1960s 540, 1970s 469, 1980s 491, 1990s 477, 2000s 389, later 5 |
| dob after 2028 (impossible) | 5 rows: 2044, 2049, 2059, 2060, 2077 |
| age at signup under the rule | below 0: 5, 10 to 16: 22, 16 to 18: 78, 18 to 100: 2360, above 100: 1 (103.3 years) |
| minors with intakes | 54 patients; their 70 intakes carry legacy outcomes approved 48, rejected 12, pending 10 |
| duplicate pairs written in two formats | `03-02-1960` and `02/03/1960` (one person, H-5 group 1) read to the same date under the rule; so do the other two mixed-format twins |

```sh
npm run profile:hypotheses    # H-1 tables
```

The minors check reads dob and submitted_at with the H-1 rule and classes outcomes as approved
(`approved`, `goedgekeurd`, `ok`), rejected (`rejected`, `afgewezen`, `declined`) or pending.

**Possible warnings**

1. A birth date read with the wrong ordering is a silent error: `03-02-1960` becomes a different
   valid date, nothing fails, and age-based eligibility is then computed on a wrong age. This is
   the column where guessing hurts most.
2. The rule "ordering follows the separator" is inferred from the data. It has 1479 unambiguous
   supporting values and no counterexample in this file, and it makes the mixed-format duplicate
   pairs agree. It is still an inference about *this* export: a future export from another
   automation could break it, so the rule must be versioned and the raw string kept.
3. Under the rule, 710 ISO and 277 non-ISO values remain formally ambiguous (both parts at most
   12). They are not ambiguous under the rule; they are ambiguous only if the rule is rejected.
   Flagging 987 rows would be flagging the rule, not the rows.
4. 5 birth dates are in the future and 1 gives an age above 100. No reading fixes them; they are
   wrong values that need a human.
5. 100 patients were under 18 at signup and 54 of them have intakes, 48 of which were approved.
   Either the birth dates are wrong or minors were treated. Part B's age rule would reject every
   one of them; running that detector over history (CLAUDE.md §5) will surface these as review
   items without touching the historical outcome.
6. The export stores dates without time zone, and dob needs none. Store as a calendar date, never
   as a timestamp, or a UTC conversion will shift birthdays by a day.

**Agreed** (2026-09-09)

Read dob with the separator convention: ISO = Y-M-D, dash = D-M-Y, slash = M-D-Y. Every non-ISO
value gets a normalisation record with rule code `DATE_ORDER_FROM_SEPARATOR` and the H-1 evidence
(1479 unambiguous values, 0 counterexamples); ISO values are stored unchanged. Store as a calendar
date, keep the raw string. The 6 impossible dates (5 future, 1 above 100) get canonical null and a
per-row review item.

The convention is inferred from the data, so it produces **one** vocabulary-level review item:
"Confirm the separator convention (dash = D-M-Y, slash = M-D-Y)", carrying the H-1 evidence, which
a human approves once. Row-level items for the 921 formally ambiguous values only where the
alternative reading changes a consequence: the alternative reading flips minor/adult at the time
of an intake for 6 patients (6 intakes; 3 at signup), so those 6 rows get a review item, the other
915 do not. Minors are otherwise not a dob problem: they become review items when the age detector
runs over history, outcome untouched. Any value not matching one of the three shapes in a future
export is a review item, never a guess.

The importer is not a rule engine: mapping is plain deterministic parser code. "Rule" in a
normalisation record is a string code plus evidence, and "versioned" means the record carries the
import run and importer version. "Warning" and "proposed autofix" are not separate mechanisms: they
are review items on the one queue, optionally carrying a proposed resolution that is applied only
on operator consent and logged as a human decision. The term is *review item* everywhere.

### sex

**Facts** (P-5, H-4)

| fact | value |
|---|---|
| rows / empty / distinct raw / distinct folded | 2466 / 0 / 11 / 7 |
| whitespace, digits, other characters | none |
| raw values | `male` 267, `M` 256, `Male` 237, `m` 236, `female` 223, `man` 223, `vrouw` 212, `F` 209, `f` 207, `Female` 201, `V` 195 |
| folded values | `male` 504, `m` 492, `female` 424, `f` 416, `man` 223, `vrouw` 212, `v` 195 |
| languages | English words and initials (`male`, `m`), Dutch words and initials (`man`, `vrouw`, `v`); Dutch `m` and English `m` coincide |
| spread | every spelling appears in every source and every signup year (H-4 pattern, P-36); no automation owns a spelling |
| values outside male/female | none: no empty, no `x`, `other`, `onbekend`, `non-binary` |

Closed mapping, covering all 2466 rows:

| canonical | raw spellings | rows |
|---|---|---|
| `male` | `male`, `Male`, `M`, `m`, `man` | 1219 |
| `female` | `female`, `Female`, `F`, `f`, `vrouw`, `V` | 1247 |

**Possible warnings**

1. Two languages share one letter: `M` is male in English and man in Dutch, so it is safe; `V`
   only means vrouw. There is no letter that means different things in the two languages in this
   file, but a future `W` (woman) or `O` (onbekend) would not be in the table.
2. The column is `sex` and the values are binary. Whether the new intake form asks for sex at
   birth, gender, or both is a Part B question; the legacy column cannot answer it and should not
   be relabelled as gender.
3. Nothing in the eligibility rules uses sex (age and BMI do not), so a mapping error here does
   not change an outcome. It still identifies a patient in the console and in letters.
4. A vocabulary table is only correct for the values it has seen. An unseen spelling in a future
   export must produce one vocabulary-level review item ("new value `X` in sex, N rows"), not N
   row items and not a guess.

**Agreed** (2026-09-09)

Map with the closed table above into an enum `male | female | unknown`. Every row whose raw
spelling differs from the canonical string gets a normalisation record with rule code `VOCAB_SEX`
(1976 rows: all but the 267 `male` and 223 `female`). `unknown` is reserved for empty values, none
in this export. Any raw value not in the table produces one vocabulary-level review item per new
value and the row maps to `unknown` until resolved. Keep the column name `sex`.

### bsn

**Facts** (P-6, P-34, H-5)

| fact | value |
|---|---|
| rows / empty / non-empty / distinct | 2466 / 1525 / 941 / 912 |
| shape | every non-empty value is exactly 9 digits; 0 non-digit characters, 0 whitespace, 1 value with a leading zero |
| elfproef (11-test) | 924 pass, 17 fail |
| the 17 failures | none is in a shared group, none is one digit away from another bsn in the file, 1 has a leading zero |
| presence by signup year | 2022 182 of 493, 2023 212 of 590, 2024 221 of 547, 2025 222 of 563, 2026 103 of 270: roughly 38 % in every year, no start or stop |
| shared values | 30 values on 2 rows each (60 rows) |

The 30 shared-bsn pairs, compared on folded name and dob read with the separator convention:

| the two rows have | pairs | reading |
|---|---|---|
| same name, same dob | 10 | one person, signed up twice |
| different name, same dob | 10 | includes the name variants `Braam Nair` / `Bram Nair`, `Luuk-L Dijkstra` / `Luuk Dijkstra`, `Emma-E Visser` / `Emma Visser`; likely one person |
| same name, different dob | 4 | one person with a dob error, or two people with the same name |
| different name, different dob | 6 | two different people carrying the same bsn, e.g. `Lucas Ivanov` 1989 and `Emma de Groot` 1978 |

```sh
tail -n +2 legacy_export/patients.csv | cut -d, -f6 | grep -v '^$' | sort | uniq -d | wc -l   # 30
```

**Possible warnings**

1. A bsn is a national identifier and special-category personal data under Dutch law. It was
   collected for an insurance experiment that ended. Keeping it at all is a data-minimisation
   question for Wellis, not for the importer. Until answered, it must be stored but never shown
   by default and never used as a login or lookup key exposed to patients.
2. The notes say "collected for a period, then the field was hidden". The data says 38 % of rows
   in every year, including 2026. Either the field was never hidden, or the bulk `import` and
   manual ops edits kept filling it. The claim is contradicted and the export cannot say why.
3. 17 values fail the elfproef. A failing bsn is not a valid bsn; it is a typo or a made-up
   number. Correcting it is impossible from the data (no near neighbour exists). It is a per-row
   review item, and the canonical bsn for those rows must not present as valid.
4. A bsn is unique to one person by definition, so the 30 shared values are the strongest identity
   signal in the file, stronger than email. But 6 of the 30 pairs are clearly two different
   people, so "same bsn" must not merge anything either: every pair is a conflict for a reviewer,
   with name, dob, email, phone side by side.
5. The one value with a leading zero shows the column was stored as text; a numeric column type
   would drop the zero and produce an 8-digit value that fails the elfproef. Store as text.
6. 1525 rows have no bsn. Empty is the normal case, not a defect; it must not become a review
   item.

**Agreed** (2026-09-09)

Store bsn as text exactly as exported (identifier, not quantity: leading zero significant, fixed
width, no arithmetic; `CHECK (bsn ~ '^[0-9]{9}$')`), no normalisation. Compute and store an
elfproef flag `valid | invalid | absent`; the 17 invalid rows get a per-row review item "bsn fails
the elfproef" with no proposed fix. Shared bsn between rows creates a duplicate-candidate
conflict, never a merge. The 1525 empties are `absent`, no item. One vocabulary-level review item
for the reviewers: "bsn retention: keep, mask, or drop" (GDPR, Q7-adjacent), and the console
masks bsn by default until it is answered.

### phone

**Facts** (P-7, P-34, H-5)

| fact | value |
|---|---|
| rows / empty / distinct | 2466 / 143 / 2263 |
| written forms | `+316xxxxxxxx` 1064, `06-xxxxxxxx` 763, `06xxxxxxxx` 496; nothing else (0 with `0031`, spaces, dots, brackets or a foreign prefix) |
| digits | 11 when written `+31`, 10 when written `06`; no other lengths |
| network type | every value is a Dutch mobile number (`+316` or `06`); 0 landlines |
| whitespace | 0 rows |
| shared numbers, compared on digits only | 61 numbers on 2 rows each (122 rows) |
| shared numbers after E.164 normalisation | the same 61; no pair is the same number written in two forms |

The 61 shared-phone pairs, compared on folded name and dob read with the separator convention:

| the two rows have | pairs |
|---|---|
| same name, same dob | 29 |
| same name, different dob | 14 |
| different name, same dob (includes the `-L`, `-E`, `-T` name variants) | 18 |
| different name, different dob | 0 |

Unlike bsn, no shared phone belongs to two clearly different people.

```sh
tail -n +2 legacy_export/patients.csv | cut -d, -f7 | grep -v '^$' | sed 's/^06/+316/; s/-//' | sort | uniq -d | wc -l   # 61
```

**Possible warnings**

1. Three spellings of one thing. `06-53549409`, `0653549409` and `+31653549409` are the same
   number and the same format family; converting all to E.164 (`+31653549409`) is a deterministic
   format conversion with no ambiguity in this file (every value is Dutch, every value is mobile,
   every digit count is right). It changes 1259 stored values and therefore needs a normalisation
   record per row.
2. The conversion is only safe because the input is this clean. A future value like `0031 6 ...`,
   `+44 ...`, `020-1234567` (landline) or `06-1234567` (9 digits) is outside what we have seen and
   must not be silently forced into E.164; it is a review item.
3. A phone number is a household or family device as often as a personal one, so a shared number
   is a weaker identity signal than bsn. Here it never joins two clearly different people, which
   makes it a good *confirming* signal for the name-variant duplicates, not a merge key.
4. 143 rows have no phone. That is a missing contact channel, not a defect of the import; no
   review item, but the console should show it as absent.
5. Dutch mobile numbers are 9 digits after the country code and always start with 6. The check
   constraint should encode exactly that (`^\+316[0-9]{8}$`) so a wrong length cannot be stored as
   canonical.

**Agreed** (2026-09-09)

Canonical phone in E.164. The 1064 `+316` values are stored unchanged; the 1259 `06` values are
converted with rule code `PHONE_E164_NL_MOBILE`, one normalisation record each. Check constraint
`^\+316[0-9]{8}$` on the canonical column, raw kept. Any value that does not match one of the
three seen forms maps to null and gets a per-row review item with a proposed fix when a reading is
obvious (for example `0031 6...`) and none otherwise. Shared canonical phone creates a
duplicate-candidate conflict, never a merge. Empties are null, no item.

### city

**Facts** (P-8)

| fact | value |
|---|---|
| rows / empty / distinct raw / distinct folded | 2466 / 0 / 20 / 20 |
| whitespace, case variants, misspellings | none: 20 folded values each have exactly one raw spelling |
| values | 20 real Dutch cities, `Zwolle` 156 down to `Groningen` 104; `Den Haag` written that way on all 123 rows |
| spread | every city in every year and source (P-36) |
| agreement inside duplicate-candidate pairs | name+dob pairs 0 of 31 differ, phone pairs 0 of 61 differ, email pairs 2 of 44 differ, bsn pairs 5 of 30 differ |

The bsn pairs that differ on city are among the pairs that also differ on name and dob, i.e. the
ones that look like two different people sharing a bsn.

```sh
tail -n +2 legacy_export/patients.csv | cut -d, -f8 | sort | uniq -c | wc -l   # 20
```

**Possible warnings**

1. Nothing to normalise. The column is cleaner than the notes suggest ("self-reported" implied
   variation that is not there). Any cleanup would be a change without evidence.
2. The uniform spread across 20 cities with no small towns, no postcode and no street is a sign
   that the value comes from a pick-list, not free text. Good for us, but it also means the
   column carries little information: it cannot locate a patient or a pharmacy.
3. City is not identity and not medical. It must not enter duplicate detection as a key, but it is
   a useful side-by-side field in a conflict: two rows with the same bsn and different cities are
   more likely two people.
4. Self-reported city can lag a move. Nothing in the export dates it, so it should be shown as
   "city at signup", not as a current address.

**Agreed** (2026-09-09)

Store as-is, free text, no normalisation, no vocabulary table. Not a key for anything. Shown in
conflict views as a side-by-side field labelled "city at signup". Future values need no review
item.

### weight and weight_unit

Discussed as a pair: a weight without its unit is not a measurement.

**Facts** (P-9, P-10, P-20, H-2)

| fact | value |
|---|---|
| weight: rows / empty / numeric | 2466 / 105 / 2361; decimal point on every value, 0 non-numeric |
| weight shapes | `999.9` 1367, `99.9` 989, `9.9` 5 |
| weight_unit values | `kg` 2393, `lbs` 55, empty 18 |
| empty unit | all 18 rows carry a weight |
| empty weight | all 105 rows carry unit `kg` |
| distribution, unit `kg` (n 2288) | min 6.5, p5 71.5, median 103.1, p95 145.8, max 166.3 |
| distribution, unit `lbs` (n 55) | min 144.6, median 225.5, max 356.9 |
| distribution, empty unit (n 18) | min 140.2, median 208.1, max 320.1 |
| BMI window 15 .. 70 with height_cm | 45 rows fall outside it read as kg and inside it read as pounds; they are the `lbs` rows and the empty-unit rows above 200 |
| intake weight / patient weight, `kg` rows (H-2) | 2684 of 2688 intakes within 0.90 .. 1.10; 2 in 0.49 .. 0.90, 2 above 1.10 |
| intake weight / patient weight, `lbs` rows | 0 of 68 within 0.90 .. 1.10; 15 within the pounds band 0.42 .. 0.49; 23 below 0.40, 5 in 0.40 .. 0.42, 25 in 0.49 .. 0.90 |
| intake weight / patient weight, empty-unit rows | 0 of 20 within 0.90 .. 1.10; 1 within the pounds band; the rest spread 0.25 .. 0.90 |
| `kg` rows below 35 | 5 rows: 6.5, 7.2, 7.7, 7.8, 8.6; their intakes are equally small (5.7 .. 9.1) |
| rows at 300 or above | 9 rows: 7 `lbs`, 2 empty unit |

Intake weights are kilogram-scale throughout (P-20: max 167.1, no unit column).

**What the numbers say**

- `kg` rows are internally consistent: patient weight and intake weight agree within 10 % in
  99.85 % of cases. The notes' "self-reported, so they can legitimately differ" is true but
  small in practice.
- `lbs` rows are certainly not kilograms (not one agrees with an intake as-is). Read as pounds
  they land in a plausible human range and a plausible BMI, but they still agree with the same
  patient's intakes in only 15 of 68 cases. The unit is right; the *value* does not reconcile
  with the rest of that patient's record.
- Empty-unit rows behave exactly like `lbs` rows and not at all like `kg` rows: same value range
  (140 .. 320), zero same-unit agreement, plausible only as pounds. Nothing distinguishes them
  from `lbs` rows except the missing label.
- The 5 tiny `kg` weights are not a patient-row typo: the intakes carry the same tiny scale, so
  whatever went wrong happened to that patient's data as a whole. No multiplier is evidenced.

```sh
npm run profile:hypotheses    # H-2 tables
```

**Possible warnings**

1. Weight drives BMI, and BMI drives two eligibility rules. A wrong unit changes an outcome:
   225 read as kg is a BMI around 60; read as pounds it is around 28, right on the flag band.
   This is the highest-consequence mapping in the patient file.
2. Converting an explicit `lbs` value is a deterministic unit conversion, not a guess, and needs
   a normalisation record per row. But the converted weight disagrees with the patient's own
   intakes far more often than any `kg` row does. The conversion is correct as arithmetic and the
   result is still suspicious as data.
3. "Empty unit means pounds" is an inference. It is well supported (18 of 18 rows in the pounds
   range, 0 of 18 in the kilogram range, same intake behaviour as `lbs` rows) but it is one
   decision, and CLAUDE.md §5 says it belongs to a human once, not to 18 row guesses.
4. R-A36: divergence between patient weight and intake weight must not be treated as an error.
   It can, however, be *noticed*: a patient whose signup weight disagrees with every intake by
   more than 10 % is exactly the record a reviewer wants to see before the BMI is trusted. That
   is a review item, not a rejection.
5. The 105 missing signup weights are not a defect; the intake carries a weight. No item.
6. Storage: one canonical column in kilograms with one decimal, raw value and raw unit kept. Never
   store a canonical value in mixed units with a unit column beside it; that is how the legacy
   system got here.

**Agreed** (2026-09-09)

1. Canonical `weight_kg`, numeric with one decimal, raw value and raw unit kept. `kg` rows are
   stored unchanged.
2. `lbs` rows are converted with rule code `WEIGHT_LBS_TO_KG` (factor 0.45359237), one
   normalisation record each (55 rows).
3. Empty-unit rows: canonical null plus **one** vocabulary-level review item "18 rows have a weight
   and no unit; evidence says pounds", carrying the H-2 evidence and the proposed fix "convert as
   pounds". Its payload lists all 18 rows with both readings and both BMIs: as kg 57.4 to 92.5, as
   pounds 26.0 to 42.0, six of them between 26.0 and 27.2, on the eligibility threshold. The
   operator may exclude individual rows before the fix is applied. One decision, consequence
   visible per patient. Each converted row gets a human-decision record.
4. Divergence detector, every patient regardless of unit: canonical signup weight outside 0.9 to
   1.1 of **every** intake weight of that patient. The tolerance is derived from the `kg` rows
   (2684 of 2688 intakes within it), not chosen. Routing by what a reviewer can decide:
   - `kg` rows: per-row review item, no proposed fix. 3 patients (4 intakes) in this export.
   - `lbs` rows: the non-reconciliation is systematic (49 of 68 intakes outside the tolerance after
     conversion, 30 of 46 patients disagree with all their intakes, against 4 of 2688 for `kg`).
     Fifty identical items give a reviewer nothing to decide, so this becomes one entry in the
     import report's unexpected findings plus **one** vocabulary-level review item carrying that
     evidence. No per-row items.
   - Empty-unit rows run through the detector only after item 3 gives them a canonical value.
5. 105 empty weights: null, no item.
6. Plausibility detector, shared by the whole system: `weight_kg` outside [30, 300] or `height_cm`
   outside [100, 230] produces a per-row review item, canonical null, raw kept, no proposed fix.
   The divergence detector is silent on these rows because the intakes repeat the same values
   (tiny weights 5.7 to 9.1, heights 15, 45, 45, 51, 300), so a separate detector is needed. In
   this export it fires on 5 patient weights (6.5 to 8.6) and 5 patient heights; the item carries a
   proposed fix when exactly one decimal shift lands in the plausible range (7.8 → 78, 15 → 150),
   the same rule for weight and height (amended 2026-09-09); over `intakes.csv` on 6 weights
   below 30 and 6 heights out of range. The bounds live in the rules file, not in code: the same
   definition of "physically possible" becomes the Part B form validation and Part B will version
   it.

### height_cm

**Facts** (P-11, P-21, H-3)

| fact | value |
|---|---|
| rows / empty / distinct | 2466 / 0 / 51 |
| shape | integers only: `999` 2462, `99` 4; 0 decimals, 0 unit text, 0 whitespace |
| distribution | min 15, p5 153, median 175, p95 196, max 300 |
| values outside [100, 230] | 5 rows: 15, 45, 45, 51, 300 |
| metres (1.50 .. 2.20) or inches (55 .. 80) | 0 rows: "always intended as centimetres" holds for the plausible values |
| intake height vs patient height | byte-identical on 2896 of 2896 resolvable intakes (H-3); the 5 odd values are repeated in every intake of those patients |

```sh
tail -n +2 legacy_export/patients.csv | cut -d, -f11 | awk '$1<100 || $1>230' | sort | tr '\n' ' '   # 15 300 45 45 51
```

**Possible warnings**

1. Height is the other half of BMI. A height of 45 cm with a weight of 96.9 kg gives a BMI of 478;
   nothing downstream would catch that unless the plausibility detector (weight agreement, item 6)
   nulls the canonical value first.
2. EXPORT-NOTES.md says intake height is self-reported at submission time. The data says it is a
   copy of the patient row, every time. So a wrong patient height is wrong on every intake of that
   patient: the error is correlated, not independent, and the intake cannot be used to
   cross-check the patient row for height the way it can for weight.
3. The column is integer centimetres with no decimals. A future export in metres (`1.75`) or with
   a decimal centimetre (`175.5`) is outside what we have seen; the first must be a review item,
   the second a documented conversion.
4. The 300 is possibly 200 with a typo and the 15 possibly 150 with a dropped digit. Both are
   hypotheses; neither has evidence in the export and neither becomes a proposed fix.

**Agreed** (2026-09-09)

Canonical `height_cm` integer, stored unchanged, raw kept. No normalisation in this export. The
shared plausibility detector (weight item 6, bounds in the rules file) handles the 5 out-of-range
rows: canonical null, per-row review item. The item carries a **proposed fix when exactly one
decimal shift lands in the plausible range**: `15` → 150 (×10), and for future exports `1.5` → 150
and `1.75` → 175 (×100, metres). `45`, `51` and `300` have no shift that lands in range and get no
proposed fix. The import report records under unexpected findings that intake height is a copy of
the patient row in 2896 of 2896 cases, contradicting the notes. Any non-integer or unit-bearing
value in a future export is a review item, with the same decimal-shift proposal where it applies.

Check (1): no stored value differs from raw in this export, so no records; the 5 nulled rows keep
their raw value. Check (2): 5 row items, each a distinct patient with a distinct fix to accept or
reject; no vocabulary-level item needed.

### status

**Facts** (P-12, H-4)

| fact | value |
|---|---|
| rows / empty / distinct raw / distinct folded | 2466 / 0 / 17 / 11 |
| trailing whitespace | 251 rows, all the single value `active ` |
| languages | English and Dutch, words and phrases; casing varies (`ACTIEF`, `Churned`) |
| spread | every spelling in every source and every signup year (H-4); no automation owns one |
| relation to intakes.outcome | 0 folded values in common (P-25); the two vocabularies do not overlap |

Closed mapping onto the four classes EXPORT-NOTES.md names, covering all 2466 rows:

| canonical | raw spellings (rows) | rows |
|---|---|---|
| `active` | `Active` 297, `active` 268, `active ` 251, `ACTIEF` 275, `actief` 273 | 1364 |
| `churned` | `cancelled` 170, `Churned` 164, `churned` 158, `opgezegd` 158 | 650 |
| `paused` | `paused` 73, `on hold` 59, `Paused` 56, `gepauzeerd` 54 | 242 |
| `prospect` | `Prospect` 56, `new` 53, `lead` 51, `prospect` 50 | 210 |

```sh
tail -n +2 legacy_export/patients.csv | cut -d, -f12 | sort | uniq -c | sort -rn   # 17 spellings
```

**Possible warnings**

1. Status is the patient's *commercial* standing and outcome is the intake's *medical* result
   (CLAUDE.md §6). The two vocabularies happen not to overlap here, but `ok`, `open` and
   `pending` would read naturally as statuses; the mapping tables must stay separate and a value
   from one must never be looked up in the other.
2. Three of the class assignments are inferences about meaning, not spelling: `cancelled` →
   churned, `on hold` → paused, `new` and `lead` → prospect. They are the obvious readings and
   the notes give only these four classes, but "cancelled" could have meant "cancelled before
   ever starting" in some funnel, which is closer to prospect than to churned. Low consequence
   (nothing medical depends on status), so a documented mapping is enough; it should still be
   visible in the import report so the ops team can object.
3. The 251 `active ` rows are the largest single whitespace defect in the file. Trimming is safe
   and needs a normalisation record like every other trim.
4. Status is a snapshot at export time with no date. It must be shown as "status at export", and
   the new system must not treat it as current once patients start interacting again.
5. Any unseen value in a future export produces one vocabulary-level review item and maps to
   `unknown` until resolved, exactly as for `sex`.

**Agreed** (2026-09-09)

Map with the closed table into `active | paused | churned | prospect | unknown`. Rows whose raw
spelling differs from the canonical string get a normalisation record with rule code
`VOCAB_STATUS` (1917 rows: all but `active` 268, `paused` 73, `churned` 158, `prospect` 50). The
three meaning-level assignments (`cancelled` → churned, `on hold` → paused, `new`/`lead` →
prospect) are listed in the import report under rules applied. Unseen values: one
vocabulary-level review item, `unknown` until resolved. Never joined with the outcome table.

Check (1): 1917 rows differ from raw (case, whitespace or synonym) and each has a `VOCAB_STATUS`
record. Check (2): no row items; a new spelling is one vocabulary-level item.

### signup_date

**Facts** (P-13, P-35, P-36, H-1)

| fact | value |
|---|---|
| rows / empty / distinct | 2466 / 0 / 1570 |
| shapes | `9999-99-99` 1819, `99-99-9999` 360, `99/99/9999` 287; nothing else |
| separator convention (H-1) | 1499 unambiguous values, 0 counterexamples, 0 unreadable |
| range under the convention | 2022-01-04 to 2026-06-20, plus 3 rows in 2062 |
| non-ISO shapes by year of the value | 2022: 232 of 493, 2023: 287 of 590, 2024: 128 of 547 (latest 2024-05-30), 2025 and 2026: 0 |
| non-ISO share by source | import 107 of 417, typeform 226 of 845, campaign 114 of 415, website 97 of 400, referral 103 of 389: about a quarter everywhere |
| intakes before signup, under the convention | 0 of 2896; 12 on the signup day, 299 within 30 days, 1775 within a year, 810 later |
| consent events before signup | 6 of 2643 events (3 to 23 days early), none of them a first grant; 160 on the signup day |
| the 3 rows dated 2062 | `recNFRrTp1VM8q7fw` (typeform), `recuSs76Rr161XtAA` (typeform), `reckIDPmvFjD5ppYo` (import); their intakes and consent events are also dated 2062, consistently, and their dobs are normal (1958 to 1979) |

```sh
tail -n +2 legacy_export/patients.csv | cut -d, -f13 | grep -c '^2062'   # 3
```

**Possible warnings**

1. Same silent-error risk as dob for the 647 non-ISO values, resolved by the same convention. The
   fact that the convention yields zero intakes before signup (297 would be, under other
   readings) is the strongest single piece of evidence that it is right; it should be cited in
   the vocabulary-level item that confirms the convention.
2. The notes' "ISO at some point in 2024" is roughly right but incomplete: both styles coexist
   from 2022 until May 2024, in every source at about the same rate, and then non-ISO stops. So
   no automation was "the US-style one"; the export itself contradicts the story of a single
   culprit. The profile's verdict "contradicted" is about the claim that ISO started in 2024; ISO
   was the majority all along.
3. Three patients live entirely in 2062: signup, intakes and consent all shifted the same way,
   dob untouched. That is a systematic offset in one pipeline, not a typo, and the offset is not
   derivable from the data (36 years to 2026 is a guess). Every date of those three patients is
   affected and their records are unusable for anything time-based (consent recency, age at
   intake) until a human decides.
4. signup_date is "when the row was created". It is a date, not a timestamp, with no time zone;
   store it as a calendar date. It is also the only anchor for "age at signup" and for the
   consent-before-signup check.
5. The 6 consent events that precede signup are all revocations of the "revoked then granted"
   patients (P-33). That points at timestamp trouble in the consent log rather than in this column;
   handled under consents.

**Agreed** (2026-09-09, recorded by the agent under the standing instruction; checked against the
two questions below)

Same handling as dob: separator convention, one normalisation record with rule code
`DATE_ORDER_FROM_SEPARATOR` per non-ISO row (647 rows), stored as a calendar date, raw kept, covered
by the same single confirmation item as dob. The 3 rows in 2062 get canonical null and one review
item each that lists all of that patient's shifted dates (signup, intakes, consents) side by side,
no proposed fix. The zero-intakes-before-signup result and the May 2024 cut-over go into the import
report under unexpected findings.

Check (1): the 647 converted values are the only stored values that differ from raw and each has a
record naming `DATE_ORDER_FROM_SEPARATOR`; the 1819 ISO values are stored unchanged. Check (2): the
convention itself is one vocabulary-level item shared with dob, not 647 row items; the 3 row items
are distinct patients whose whole record is shifted, each an individual decision.

### source

**Facts** (P-14, P-36, H-4)

| fact | value |
|---|---|
| rows / empty / distinct | 2466 / 0 / 5 |
| values | `typeform` 845, `import` 417, `campaign_expat_2023` 415, `website` 400, `referral` 389 |
| whitespace, case variants | none |
| named in EXPORT-NOTES.md | `typeform`, `website`, "campaign tags" (`campaign_expat_2023` is the only one), `import`; `referral` is not mentioned |
| what source explains | nothing measurable: every status, sex and date spelling appears in every source at about the same rate (H-4); non-ISO dates are about a quarter of every source |
| `lbs` by source | typeform 17, referral 14, campaign_expat_2023 12, import 6, website 6 |
| empty weight unit by source | campaign 6, typeform 5, import 4, referral 2, website 1 |
| bsn present by source | 36 % to 41 % in every source |
| the 5 tiny weights | campaign 2, referral 2, import 1 |
| the 3 rows dated 2062 | typeform 2, import 1 |

```sh
tail -n +2 legacy_export/patients.csv | awk -F, '{print $14" "($10==""?"(empty)":$10)}' | sort | uniq -c
```

**Possible warnings**

1. The notes tie pounds to "an early campaign targeting expats". The data does not: `lbs` rows
   come from every source and typeform has the most. Whatever produced pounds was not one funnel.
   The same holds for date styles and status spellings. Source-specific parsers would be built on
   a story the data contradicts, so there must be none.
2. `import` is "a bulk load nobody remembers well". Its 417 rows are indistinguishable from the
   rest on every measure we have. That is reassuring for the import and useless for provenance.
3. `referral` exists and is not in the notes. Harmless, but it shows the notes' value list is
   incomplete, which is the general lesson for every "closed" list they give.
4. Source is a filter for the console and a dimension for the import report, nothing else. It is
   not identity and not medical.

**Agreed** (2026-09-09, recorded by the agent under the standing instruction; checked against the
two questions below)

Store as-is, free text, no normalisation, no mapping table. Used as a console filter and as a
dimension in the import report. No source-specific parsing anywhere. The import report lists
`referral` as a value the notes did not name and states that no defect in the file correlates with
source, under unexpected findings. Unseen future values are stored as they come; no review item.

Check (1): no stored value differs from raw, so no records. Check (2): no review items; nothing
here is a decision a human could act on.

---

## intakes.csv

### intake_id

**Facts** (P-16, P-27)

| fact | value |
|---|---|
| rows / empty / distinct | 2917 / 0 / 2917 |
| shape | `INT-9999` on every row; numbers 7001 to 9917, all 2917 values in that range used exactly once |
| whitespace, case | none |
| order | id order is not date order: 1443 of 2916 adjacent id pairs are out of date order |
| adjacent ids on the same patient and day | the same-day double submissions of P-27 have consecutive ids (`INT-7532`/`INT-7533`, `INT-8763`/`INT-8764`, `INT-7254`/`INT-7255`) |

```sh
tail -n +2 legacy_export/intakes.csv | cut -d, -f1 | sort -u | wc -l   # 2917
```

**Possible warnings**

1. Dense, gap-free, and unrelated to submission order: the ids look assigned at export time or
   renumbered, not issued by the form tool as submissions came in. Nothing in the export tells.
   The id is unique here and is the only handle on a row, so it is the natural idempotency key,
   but a future export could renumber and the key would then match different rows. Keep the
   export's identity (file, run) next to the id.
2. Consecutive ids on the same patient and day are the one thing the ordering does reveal: a
   real double submission minutes apart. Useful as a side-by-side hint in the duplicate-intake
   review, not as a rule.
3. Store as text, opaque, like legacy_id. The numeric part is not a quantity.

**Agreed** (2026-09-09, recorded by the agent under the standing instruction; checked against the
two questions below)

Store as-is, text, unique, opaque. Idempotency key for intake rows together with the import run's
source identity. No normalisation, no review items.

Check (1): no stored value differs from raw. Check (2): no review items.

### legacy_patient_id

**Facts** (P-17, P-27, P-32, H-1)

| fact | value |
|---|---|
| rows / empty / distinct | 2917 / 0 / 2040 |
| shape | same 17-character `rec...` format as patients.legacy_id on every row; no whitespace, no case issues |
| resolves to patients.csv | 2896 rows; 21 do not |
| orphans | 21 rows, 21 distinct ids; not case variants of any patient id; none appears in consents.jsonl |
| orphans by submitted year | 2022: 3, 2023: 5, 2024: 6, 2025: 6, 2026: 1 (every year, no burst) |
| orphans by questionnaire_version | `v1` 11, `v2` 10; none with `v3`, `2.0` or empty |
| orphans' legacy outcome | approved-class 11 (`approved` 6, `goedgekeurd` 3, `ok` 2), rejected-class 5, pending-class 5; reviewer_note empty on all 21 |
| orphans with a look-alike patient (same height, weight within 10 %, signup at most a year earlier) | none 7, exactly one 3, several 11 |
| patients with no intake | 447 of 2466 |
| intakes per patient | 1: 1311 patients, 2: 581, 3: 148 |
| same patient, same submission day | 5 pairs once dates are read with the separator convention (P-27 counts 4 on raw strings); ids consecutive in 3 of them; weights differ by 1 to 3 kg; outcomes agree in 2 pairs, disagree in 3 (`in review` vs `goedgekeurd`, `Rejected` vs `in review`, `afgewezen` vs `rejected` agree) |

```sh
tail -n +2 legacy_export/patients.csv | cut -d, -f1 | sort -u > /tmp/p.txt
tail -n +2 legacy_export/intakes.csv | cut -d, -f2 | grep -v -x -F -f /tmp/p.txt | wc -l   # 21
```

**Possible warnings**

1. The notes say the automation "occasionally fired before the patient row existed". Under that
   story the patient row would appear later and the orphan would resolve. In this export it never
   does: 21 patient rows are simply missing, across all years. Either they were deleted, or the
   export is incomplete, or the id was written wrongly. The export cannot say which.
2. An orphan intake is medical data (weight, medication, conditions, an outcome) about a person
   we cannot name. Dropping it loses a decision someone made; attaching it to a guessed patient
   puts medical data on the wrong person. The 3 orphans with exactly one look-alike patient are
   tempting and still a guess: same height and similar weight are shared by many people.
3. 11 of the 21 orphans were approved. If the person later shows up as a new intake, the history
   that a doctor approved them once is invisible unless the orphan is kept somewhere findable.
4. A foreign key constraint from intakes to patients would reject the 21 rows at load time and
   the importer would either fail or silently drop them. The schema needs a place for an intake
   whose patient is unknown that still keeps referential integrity.
5. Same-day double submissions are real duplicates of an intake, not of a patient. Two rows with
   consecutive ids, weights 2 kg apart and one saying `in review` while the other says
   `goedgekeurd` cannot both be the outcome of record. Which one counts is a decision.
6. Once patient rows are merged (duplicate candidates), an intake's `legacy_patient_id` must still
   resolve through the alias table decided under `patients.legacy_id`; the intake keeps the id it
   was exported with.

**Proposed** (awaiting explicit confirmation)

Store the raw id on every intake unchanged. Resolution goes through the alias table, so after a
merge the intake still resolves. For the 21 orphans: the intake is stored in full with
`patient_id` null and the raw `legacy_patient_id` kept; a *placeholder patient* is **not** created
(it would be a fabricated record). Each orphan gets one row-level review item "intake references a
patient that does not exist" whose payload shows the intake and, as context only, the look-alike
patients (0, 1 or several) with the fields that matched; the reviewer may attach the intake to an
existing patient, create a patient from the intake's own data, or leave it unresolved. No proposed
fix, not even for the 3 single look-alikes. The 5 same-day pairs get one row-level review item per
pair, both intakes side by side, no proposed fix; both intakes stay stored and keep their legacy
outcome. The import report lists 21 orphans and 5 same-day pairs under quarantined, and the
contradiction of the "fired before the row existed" story under unexpected findings.

Check (1): no stored value differs from raw. Check (2): 21 + 5 row items, each about a different
person or pair and each with three distinct possible actions; nothing repeats identically.

**Agreed** (2026-09-09)

As proposed, with two amendments. Store the raw id unchanged on every intake; resolution goes
through the alias table. Orphans are stored in full with `patient_id` null and the raw
`legacy_patient_id` kept; **no placeholder patient** is created: a synthetic patient row with no
name, no date of birth and no email is a fabricated record, while a null reference plus a review
item says what we actually know (departure from the Q9 default in `QUESTIONS.md`, updated there).
Each orphan gets one row-level review item whose payload shows the intake and, as context only,
its look-alike patients. The reviewer has **two** actions: attach to an existing patient (note
required, because even the 3 single look-alikes are a guess) or leave unresolved. "Create a
patient from the intake" is dropped: the intake carries no identity fields, so that patient would
be the same placeholder made by hand. An orphan that stays unresolved is an acceptable outcome;
the report counts them. The 5 same-day pairs get one item per pair, both intakes kept with their
legacy outcome, no outcome of record until a reviewer decides; listed under unexpected findings
as well as under quarantined.

Check (1): no stored value differs from raw. Check (2): 21 + 5 row items, each a different person
or pair with distinct actions.
