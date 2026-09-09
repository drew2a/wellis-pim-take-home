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

**Agreed**

_Not yet discussed._
