-- ADR-0027: the reviewer role is removed. It gated `in_review -> approved` and
-- `in_review -> rejected` on `doctor`, in a console with one shared secret where the reviewer
-- picks their own name from a list (ADR-0021) — so it refused nobody. What still closes an
-- approval is the intake's own evaluation (Q1's absolute age reject), which is enforced in
-- `src/intake/machine.ts` and refuses every reviewer alike.
--
-- The state-machine trigger of 0007 is untouched: it never saw the role (its own header says so),
-- and the ten edges are unchanged, so the table it mirrors still matches.
--
-- Not reversible from here. What is lost is two labels on two seeded rows, which
-- `npm run seed:reviewers` writes again from REVIEWERS.
ALTER TABLE "reviewers" DROP COLUMN "role";--> statement-breakpoint
DROP TYPE "public"."reviewer_role";