# ADR-0002: Adopt ivory-tower engineering conventions

- **Status:** proposed
- **Date:** 2026-09-08
- **Deciders:** Andrei Andreev (pending)
- **Requirements:** R-T1, R-T2, R-T7, R-T8, R-T10, R-P6

## Context and problem statement

The assignment is built by an AI agent across many sessions, and it grades commit history
as a deliverable (§4: "real commit history"). Without a written convention the agent picks
a different style each session — mixed commit moods, inconsistent naming, tests written
for coverage rather than for correctness. The repo owner maintains a personal conventions
collection (https://github.com/drew2a/ivory-tower); the question is whether to adopt it
verbatim, adopt it with adaptations, or write conventions specific to this repo.

The source conventions are stack-agnostic and assume a team context (ticket keys, a second
reviewer, release branches). This repo is a solo, 7-day, TypeScript assignment with no
issue tracker.

## Decision drivers

- The agent needs rules that are mechanically checkable, not aspirational prose.
- Commit history is graded (R-T10), so commit and branch conventions must be fixed up
  front — history cannot be retro-fitted without squashing, which is forbidden.
- Existing history already uses Conventional Commits (`chore: ignore IDE configuration
  files`); consistency with it is free.
- Conventions that assume a team (reviewer sign-off, ticket keys) cannot be honoured
  literally and must not be claimed as followed when they are not.

## Considered options

1. Adopt ivory-tower with documented deviations, restated in `CLAUDE.md`.
2. Adopt ivory-tower verbatim by reference (link only, no restatement).
3. Write repo-specific conventions from scratch.

## Decision outcome

Chosen option: **Option 1 — adopt with documented deviations, restated in `CLAUDE.md`**,
because the agent reads `CLAUDE.md` every session but will not reliably fetch an external
repo, and because three of the source conventions are inapplicable to a solo repo and must
be adapted openly rather than silently ignored.

Adopted as-is:

- Design principles: DRY, KISS, YAGNI, SOLID.
- Commit messages in imperative mood (Git `SubmittingPatches`), with the Conventional
  Commits notation offered there as the alternative.
- TODO format `// TODO(owner): …`.
- OneFlow branching; integrate with rebase + `merge --no-ff`.
- Small, single-purpose branches; the imperative *what* + why-this-approach goes in the
  merge commit body.
- The pre-merge review checklist from the Google engineering-practices list.

### Deviations

| Source convention | Deviation | Reason |
|---|---|---|
| "Google code style guides" (language-neutral) | Pinned to the **Google TypeScript Style Guide**, enforced by ESLint + Prettier + `strict: true` | The stack is fixed by §4 to React/Node + TypeScript; mechanical enforcement beats review. |
| Ticket key in branch name (`feature/657-…`) | Descriptive slug (`feature/legacy-importer`) | No issue tracker exists for this assignment. |
| PR review by another developer | Local pre-merge review by an independent agent session, findings answered explicitly | Solo repo; an independent session is the closest available substitute for a second reviewer, and the review itself lands in the submitted traces. |
| SemVer version bumps per PR | Not applied | Nothing is released or consumed as a package. |
| Release branches (OneFlow's full model) | Only `main` + topic branches | A 7-day assignment has no release train. |

### Consequences

- Good: every session inherits identical conventions; commit history stays coherent
  without retro-editing.
- Good: deviations are explicit, so the follow-up conversation can see judgment rather
  than drift.
- Bad: `CLAUDE.md` duplicates content from an external repo and can fall out of date with
  it; accepted, since this assignment is short-lived and pins conventions at adoption time.
- Neutral: YAGNI is given explicit precedence over speculative generality, which will show
  up as deliberately narrow abstractions in the importer.

### Confirmation

- `git log --oneline` shows Conventional Commits in imperative mood throughout, more than
  one commit per part of the assignment.
- `npm run lint` and `tsc --noEmit` pass in CI/locally with no `any` in `src/`.
- Branch names in `git log --graph` follow `<group>/<slug>`.

## Pros and cons of the options

### 1. Adopt with documented deviations (restated in `CLAUDE.md`)

- Good: available to the agent in every session; deviations are honest and reviewable.
- Bad: duplication of an external source of truth.

### 2. Adopt verbatim by reference

- Good: zero duplication, single source of truth.
- Bad: the agent would not have the rules in context; the team-context conventions would be
  silently unfollowable.

### 3. Repo-specific conventions from scratch

- Good: exact fit to this assignment.
- Bad: discards the owner's existing, considered standards; more work for no gain.

## More information

- https://github.com/drew2a/ivory-tower (`README.md`, `pull_request.md`)
- https://google.github.io/eng-practices — the source of the PR guidance there
- Git `Documentation/SubmittingPatches` — imperative-mood rationale
- Recorded in `CLAUDE.md` §2–§3.
