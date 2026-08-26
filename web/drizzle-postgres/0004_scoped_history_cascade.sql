CREATE OR REPLACE FUNCTION hh_protect_agent_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cleanup_run_ids text;
BEGIN
  cleanup_run_ids := current_setting('hh.cleanup_run_ids', true);
  IF TG_OP = 'DELETE' AND cleanup_run_ids IS NOT NULL AND OLD.run_id = ANY(string_to_array(cleanup_run_ids, ',')) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'IMMUTABLE_ROW:%', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;
