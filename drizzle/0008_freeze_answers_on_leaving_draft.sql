-- The answers-freeze check of 0007 looked only at `OLD.state`, so it could be bypassed on the very
-- transition it exists to guard: a single statement that both left draft and rewrote the evidence —
-- `update intakes set state='submitted', answers='{...}'::jsonb where id = …` — saw `OLD.state` of
-- `draft`, passed, and then froze the row with the substituted answers.
--
-- The point of this trigger (ADR-0014 item 6) is that a hand-written UPDATE cannot do what the
-- application refuses, so the check now also fires when the row is *leaving* draft. Everything else
-- in the function is 0007's, unchanged.
CREATE OR REPLACE FUNCTION intakes_state_machine() RETURNS trigger
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
  -- other fields is allowed, rewriting its answers once it is leaving or has left draft is not
  -- (ADR-0015 item 1). Both sides of the state are checked, so the move out of draft cannot carry
  -- a rewrite with it.
  IF (OLD.state <> 'draft' OR NEW.state <> 'draft')
     AND NEW.answers IS DISTINCT FROM OLD.answers THEN
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
