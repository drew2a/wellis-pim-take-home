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

**Agreed**

_Not yet discussed._
