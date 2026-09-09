# ADR-0001: Record architecture decisions as ADRs

- **Status:** accepted
- **Date:** 2026-09-08
- **Deciders:** Andrei Andreev
- **Requirements:** R-P5, R-P6, R-P9

## Context and problem statement

The assignment grades *how decisions were made*, not only the result: schema design,
merge semantics and state modelling are named explicitly (§5), the README must carry
"key decisions with reasoning" (§7), and the 90-minute follow-up goes "deep on your
schema and import decisions" (§8). The work is done with an AI coding agent, so
decisions can otherwise disappear into chat transcripts where neither the reviewers nor a
future maintainer can find them. We need a durable, low-ceremony place for each
significant decision and its rejected alternatives.

## Decision drivers

- Decisions must be defensible live in the follow-up (R-P9).
- The README needs a source of truth for "key decisions with reasoning" (R-P6).
- `AGENT-NOTES.md` must show where the human took the wheel (R-P4b, R-P4c).
- Several decisions are made under ambiguity (`QUESTIONS.md`) and may be revised when
  answers arrive; revisions must be visible, not silent.

## Considered options

1. Architecture Decision Records in `docs/adr/`, MADR format.
2. A single `DECISIONS.md` section in the README.
3. Rely on commit messages and agent traces.

## Decision outcome

Chosen option: **ADRs in `docs/adr/` (MADR 4, one file per decision)**, because it keeps
each decision immutable and individually addressable, records rejected options, and
supersession makes revisions explicit — which a README section or commit history cannot.

### Consequences

- Good: README "key decisions" becomes a short table linking to ADRs; follow-up
  questions map onto files.
- Good: the accept-commit of each ADR is concrete evidence for `AGENT-NOTES.md`.
- Bad: small process overhead per decision; mitigated by the template and the scope test
  in `docs/adr/README.md`.
- Neutral: ADRs the agent drafts stay `proposed` until a human accepts them.

### Confirmation

Every ADR carries a `Status:` line (listed with the command in `docs/adr/README.md`);
README "Key decisions" links only to accepted ADRs; no accepted ADR is ever edited except
to change its status line.

## Pros and cons of the options

### 1. ADRs in `docs/adr/` (MADR)

- Good: immutable, addressable, alternatives recorded, supersession explicit.
- Bad: more files to maintain.

### 2. Single `DECISIONS.md` section in README

- Good: one place, no ceremony.
- Bad: grows unreadable; edits overwrite history; rejected options rarely recorded.

### 3. Commit messages and agent traces only

- Good: zero extra work.
- Bad: reasoning is scattered and hard to retrieve; traces are unedited and very long.

## More information

- ASSIGNMENT.md §5, §7, §8.
- Nygard, *Documenting Architecture Decisions* (2011); MADR 4 — https://adr.github.io/madr/
