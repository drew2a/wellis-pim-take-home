-- ADR-0011 item 1: the column held the engine's verdict translated into the legacy outcome
-- vocabulary, which has no image for `not_evaluable` except `unknown` -- a value that already
-- means "a spelling we have not seen" (ADR-0009 item 8). The comparison it existed for is a join
-- against intakes.outcome, which is already stored, and the matrix of ADR-0011 item 11 defines it.
--
-- Separate from 0003 because drizzle-kit asks whether a dropped column next to an added one is a
-- rename, and that prompt needs a terminal; generating the addition and the deletion apart keeps
-- both files reproducible by `npx drizzle-kit generate` with no interactive answer.
ALTER TABLE "eligibility_evaluations" DROP COLUMN "outcome";