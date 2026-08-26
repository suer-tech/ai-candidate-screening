CREATE OR REPLACE FUNCTION hh_validate_json_text() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE column_name text; payload text;
BEGIN
  FOREACH column_name IN ARRAY TG_ARGV LOOP
    payload := to_jsonb(NEW) ->> column_name;
    IF payload IS NOT NULL THEN PERFORM payload::jsonb; END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
