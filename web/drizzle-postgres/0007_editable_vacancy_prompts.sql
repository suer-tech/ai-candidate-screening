ALTER TABLE vacancy_generation_operations
  ADD COLUMN IF NOT EXISTS prompt_hash text,
  ADD COLUMN IF NOT EXISTS prompt_artifact_id text;
--> statement-breakpoint

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS analysis_prompt_text text,
  ADD COLUMN IF NOT EXISTS analysis_prompt_artifact_id text,
  ADD COLUMN IF NOT EXISTS analysis_prompt_hash text;
--> statement-breakpoint

ALTER TABLE vacancy_audit_events
  ADD COLUMN IF NOT EXISTS vacancy_id text,
  ADD COLUMN IF NOT EXISTS prompt_artifact_id text,
  ADD COLUMN IF NOT EXISTS before_hash text,
  ADD COLUMN IF NOT EXISTS after_hash text,
  ADD COLUMN IF NOT EXISTS trace_id text;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS vacancy_profile_versions (
  vacancy_id text NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  version integer NOT NULL,
  record_json text NOT NULL,
  created_at text NOT NULL,
  PRIMARY KEY (vacancy_id, version)
);
--> statement-breakpoint

INSERT INTO vacancy_profile_versions (vacancy_id, version, record_json, created_at)
SELECT id, COALESCE((record_json::jsonb->>'version')::integer, 1), record_json, now()::text
FROM vacancies
ON CONFLICT (vacancy_id, version) DO NOTHING;
