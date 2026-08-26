CREATE OR REPLACE FUNCTION hh_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_ROW:%', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER agent_plan_versions_append_only BEFORE UPDATE OR DELETE ON agent_plan_versions FOR EACH ROW EXECUTE FUNCTION hh_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER agent_events_append_only BEFORE UPDATE OR DELETE ON agent_events FOR EACH ROW EXECUTE FUNCTION hh_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER artifact_blobs_immutable BEFORE UPDATE ON artifact_blobs FOR EACH ROW EXECUTE FUNCTION hh_reject_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hh_drive_attachment_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.drive_file_id IS NOT NULL AND NEW.drive_file_id IS DISTINCT FROM OLD.drive_file_id THEN
    RAISE EXCEPTION 'DRIVE_ATTACHMENT_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER candidate_report_drive_attachment_once BEFORE UPDATE ON candidate_report_documents FOR EACH ROW EXECUTE FUNCTION hh_drive_attachment_once();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hh_report_ready_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document_count integer;
BEGIN
  IF NEW.state = 'READY' AND OLD.state IS DISTINCT FROM 'READY' THEN
    SELECT count(DISTINCT type) INTO document_count FROM candidate_report_documents WHERE report_version_id = NEW.id AND type IN ('candidate-results', 'abc-test');
    IF document_count <> 2 THEN RAISE EXCEPTION 'REPORT_PAIR_REQUIRED' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER candidate_report_ready_pair AFTER INSERT OR UPDATE OF state ON candidate_report_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hh_report_ready_pair();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hh_validate_json_text() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE column_name text; payload text;
BEGIN
  FOREACH column_name IN ARRAY TG_ARGV LOOP
    EXECUTE format('SELECT ($1).%I', column_name) INTO payload USING NEW;
    IF payload IS NOT NULL THEN PERFORM payload::jsonb; END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER vacancies_json BEFORE INSERT OR UPDATE ON vacancies FOR EACH ROW EXECUTE FUNCTION hh_validate_json_text('record_json');
--> statement-breakpoint
CREATE TRIGGER candidates_json BEFORE INSERT OR UPDATE ON candidates FOR EACH ROW EXECUTE FUNCTION hh_validate_json_text('record_json');
--> statement-breakpoint
CREATE TRIGGER runtime_events_json BEFORE INSERT ON agent_events FOR EACH ROW EXECUTE FUNCTION hh_validate_json_text('safe_payload_json');
--> statement-breakpoint
CREATE TRIGGER runtime_plans_json BEFORE INSERT ON agent_plan_versions FOR EACH ROW EXECUTE FUNCTION hh_validate_json_text('plan_json');
