# Architecture Decision Records

Every design decision that is hard to reverse, or that the assignment grades (schema
design, merge semantics, state modelling, rule semantics), is recorded here as an ADR.

Format: [MADR 4](https://adr.github.io/madr/) with Nygard's core sections
(Context → Decision → Consequences). One decision per file. See **Lifecycle** below for
what may be edited and when.

## Conventions

- **Filename:** `NNNN-short-kebab-title.md`, four-digit sequential, never reused.
- **Status:** `proposed` → `accepted` | `rejected`; later `deprecated` or
  `superseded by [ADR-NNNN](NNNN-....md)`.
- **Scope test:** write an ADR when the choice (a) constrains future work, (b) would be
  asked about in the follow-up, or (c) was made under ambiguity (see `QUESTIONS.md`).
  Do not write ADRs for reversible library choices unless they shape the architecture.
- **Traceability:** reference the requirement IDs from `REQUIREMENTS.md` (R-xx) and, where
  the decision resolves an open question, the question ID (Q-n) from `QUESTIONS.md`.
- **Length:** the "Pros and cons of the options" section is optional when the decision
  has two options and the trade-off is already stated in "Decision outcome". Keep ADRs
  as short as the decision allows.
- **Agent workflow:** the agent may draft an ADR in `proposed` status; only the human
  flips it to `accepted`. The accepting commit is the audit trail for `AGENT-NOTES.md`.

### Lifecycle

- While **`proposed`**, an ADR is a draft and **MAY** be edited freely.
- Once **`accepted`**, its content is immutable except the status line and trivial fixes
  (typos, broken links).
- Any change of substance is a **new ADR** that states `supersedes ADR-NNNN`; the old one
  gets status `superseded by ADR-MMMM`. **Both files stay** — nothing is deleted.
- The agent never self-accepts. The human flips `proposed` → `accepted` themselves, in a
  **separate commit from their own terminal with no co-author trailer**, so the history
  distinguishes *agent proposed* from *human accepted*.

### ADRs discovered mid-branch

This is the **normal case, not an exception**. Most graded decisions surface while code is
being written, not before.

1. On hitting a decision point that `CLAUDE.md` §1 classifies as graded (schema, merge
   semantics, states, normalisation rules, the auto-fix vs. review boundary), **stop
   implementing**.
2. Draft the ADR as `proposed` **on the same branch**, and ask the human.
3. The human decides; the agent updates the draft if needed; the human flips the status to
   `accepted` in a separate commit from their terminal (see **Lifecycle**).
4. Implementation continues **on the same branch**, and references the ADR in tests and
   commit bodies.
5. ADRs **travel with the branch** and land in `main` in the same `--no-ff` merge as the
   code they govern. ADRs governing code are **never** pushed to `main` separately and
   rebased onto.
6. If a mid-branch ADR invalidates code already on the branch, the code is fixed **on the
   branch**. If it invalidates an ADR already `accepted` in `main`, that is a supersede —
   also **on the branch**.

## Listing the ADRs

There is no hand-maintained index: filenames carry number and title, each file carries
its own `Status:` line, and a second copy would only drift. To list every ADR with its
status:

```sh
grep -H '^- \*\*Status:\*\*' docs/adr/[0-9]*.md
```
