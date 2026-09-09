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

**Agreed**

_Not yet discussed._
