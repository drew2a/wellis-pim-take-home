-- ADR-0014 item 6: the second lock. The state machine lives in `src/intake/machine.ts` and is
-- enforced by `transitionIntake`; this trigger mirrors its edge table so that a hand-written UPDATE
-- cannot drive an intake into a state the machine does not allow (R-B15, R-B16). A trigger rather
-- than revoked privileges, for the reason ADR-0007 gives: the pooler hands out one role per
-- connection string, and a trigger holds for every role in every environment.
--
-- The edge list below was generated from the TypeScript table, and
-- `src/intake/state-machine-lock.integration.test.ts` drives this database from that same table
-- over all 144 ordered pairs, so a divergence fails the build rather than reaching production.
--
-- The trigger cannot see who is acting, so actor kind, reviewer role and the age carve-out stay
-- with `transitionIntake`. The database's job is that no illegal *state* exists at all.
CREATE FUNCTION intakes_state_machine() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  -- One string per edge rather than a 2-D array: `= ANY` iterates over the elements of a
  -- multidimensional array, not over its rows, so pairs have to be compared as single values.
  legal CONSTANT text[] := ARRAY[
    'draft -> submitted',
    'submitted -> auto_cleared',
    'submitted -> auto_flagged',
    'submitted -> auto_rejected',
    'auto_cleared -> in_review',
    'auto_flagged -> in_review',
    'auto_rejected -> in_review',
    'legacy_pending -> in_review',
    'in_review -> approved',
    'in_review -> rejected'
  ];
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- `draft` for the new flow, a legacy state for the importer. An intake cannot be born approved.
    IF NEW.state::text <> ALL (ARRAY['draft', 'legacy_approved', 'legacy_rejected', 'legacy_pending', 'legacy_expired']) THEN
      RAISE EXCEPTION 'an intake cannot be created in state %; it starts as draft or a legacy state',
        NEW.state;
    END IF;
    RETURN NEW;
  END IF;

  -- What the patient submitted is the new flow's raw record and is evidence: editing an intake's
  -- other fields is allowed, rewriting its answers after it leaves draft is not (ADR-0015 item 1).
  IF OLD.state <> 'draft' AND NEW.answers IS DISTINCT FROM OLD.answers THEN
    RAISE EXCEPTION 'the answers of intake % are evidence and cannot change in state %',
      OLD.id, OLD.state;
  END IF;

  IF NEW.state IS NOT DISTINCT FROM OLD.state THEN
    RETURN NEW;  -- editing an intake's fields is not a transition
  END IF;

  IF (OLD.state::text || ' -> ' || NEW.state::text) = ANY (legal) THEN
    RETURN NEW;
  END IF;

  -- Legacy states are outside the machine (ADR-0005): a re-import may re-map an outcome spelling it
  -- could not read before (legacy_pending -> legacy_approved, ADR-0009 item 8). Crossing out of the
  -- machine back into a legacy state is not that case and stays refused.
  IF OLD.state::text LIKE 'legacy\_%' AND NEW.state::text LIKE 'legacy\_%' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION '% -> % is not a legal intake transition', OLD.state, NEW.state;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER intakes_state_machine
  BEFORE INSERT OR UPDATE ON "intakes"
  FOR EACH ROW EXECUTE FUNCTION intakes_state_machine();
