CREATE OR REPLACE FUNCTION hh_protect_agent_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM agent_runs run
    JOIN agent_goals goal ON goal.id = run.goal_id
    JOIN candidate_tombstones tombstone ON tombstone.candidate_id = goal.candidate_id
    WHERE run.id = OLD.run_id
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'IMMUTABLE_ROW:%', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
DROP TRIGGER agent_plan_versions_append_only ON agent_plan_versions;
--> statement-breakpoint
CREATE TRIGGER agent_plan_versions_append_only BEFORE UPDATE OR DELETE ON agent_plan_versions FOR EACH ROW EXECUTE FUNCTION hh_protect_agent_history();
--> statement-breakpoint
DROP TRIGGER agent_events_append_only ON agent_events;
--> statement-breakpoint
CREATE TRIGGER agent_events_append_only BEFORE UPDATE OR DELETE ON agent_events FOR EACH ROW EXECUTE FUNCTION hh_protect_agent_history();
