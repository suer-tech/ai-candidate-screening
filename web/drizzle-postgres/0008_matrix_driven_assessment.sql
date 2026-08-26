ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS workflow_version text NOT NULL DEFAULT 'legacy-v1';
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS vacancy_matrix_compilations (
  profile_version text PRIMARY KEY,
  state text NOT NULL CHECK (state IN ('CLAIMED','PUBLISHED','FAILED')),
  owner_id text NOT NULL,
  fencing_token integer NOT NULL CHECK (fencing_token > 0),
  lease_expires_at_utc timestamptz NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  repair_cycles integer NOT NULL DEFAULT 0 CHECK (repair_cycles BETWEEN 0 AND 2),
  llm_calls integer NOT NULL DEFAULT 0 CHECK (llm_calls BETWEEN 0 AND 6),
  obstacle_fingerprint text,
  same_fingerprint_retries integer NOT NULL DEFAULT 0 CHECK (same_fingerprint_retries BETWEEN 0 AND 1),
  matrix_id text,
  terminal_error_code text,
  created_at_utc timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at_utc timestamptz NOT NULL DEFAULT clock_timestamp()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS vacancy_matrices (
  id text PRIMARY KEY,
  profile_version text NOT NULL UNIQUE,
  schema_version text NOT NULL,
  compiler_policy_version text NOT NULL,
  skill_versions_json text NOT NULL,
  model_versions_json text NOT NULL,
  protected_trace_refs_json text NOT NULL,
  payload_json text NOT NULL,
  checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  created_at_utc timestamptz NOT NULL DEFAULT clock_timestamp()
);
--> statement-breakpoint

ALTER TABLE vacancy_matrix_compilations
  ADD CONSTRAINT vacancy_matrix_compilations_matrix_fk FOREIGN KEY (matrix_id) REFERENCES vacancy_matrices(id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS candidate_source_claims (
  id text PRIMARY KEY,
  candidate_id integer NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  run_id text NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  input_version_id text NOT NULL REFERENCES candidate_input_versions(id) ON DELETE CASCADE,
  profile_version text NOT NULL,
  author text NOT NULL,
  role text NOT NULL CHECK (role IN ('candidate','interviewer','recruiter','unknown')),
  role_confidence double precision,
  source_class text NOT NULL,
  directness text NOT NULL CHECK (directness IN ('direct','indirect')),
  claim_text text NOT NULL,
  locator_json text NOT NULL,
  criterion_ids_json text NOT NULL,
  provenance_ref text NOT NULL,
  created_at_utc timestamptz NOT NULL DEFAULT clock_timestamp()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS candidate_evidence_conflicts (
  id text PRIMARY KEY,
  candidate_id integer NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  run_id text NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  input_version_id text NOT NULL REFERENCES candidate_input_versions(id) ON DELETE CASCADE,
  profile_version text NOT NULL,
  predicate text NOT NULL,
  claim_ids_json text NOT NULL,
  follow_up_question text NOT NULL,
  provenance_ref text NOT NULL,
  created_at_utc timestamptz NOT NULL DEFAULT clock_timestamp()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS candidate_matrix_rows (
  id text PRIMARY KEY,
  matrix_id text NOT NULL REFERENCES vacancy_matrices(id),
  candidate_id integer NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  run_id text NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  input_version_id text NOT NULL REFERENCES candidate_input_versions(id) ON DELETE CASCADE,
  profile_version text NOT NULL,
  criterion_id text NOT NULL,
  state text NOT NULL,
  supporting_claim_ids_json text NOT NULL,
  contradicting_claim_ids_json text NOT NULL,
  checked_source_ids_json text NOT NULL,
  reason text NOT NULL,
  missing_data text NOT NULL,
  follow_up_question text NOT NULL,
  verification_state text NOT NULL,
  verification_trace_ref text,
  created_at_utc timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (run_id, criterion_id)
);
--> statement-breakpoint

CREATE TRIGGER vacancy_matrices_immutable BEFORE UPDATE OR DELETE ON vacancy_matrices FOR EACH ROW EXECUTE FUNCTION hh_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER candidate_source_claims_immutable BEFORE UPDATE OR DELETE ON candidate_source_claims FOR EACH ROW EXECUTE FUNCTION hh_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER candidate_evidence_conflicts_immutable BEFORE UPDATE OR DELETE ON candidate_evidence_conflicts FOR EACH ROW EXECUTE FUNCTION hh_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER candidate_matrix_rows_immutable BEFORE UPDATE OR DELETE ON candidate_matrix_rows FOR EACH ROW EXECUTE FUNCTION hh_reject_mutation();
--> statement-breakpoint

CREATE TRIGGER vacancy_matrices_json BEFORE INSERT ON vacancy_matrices FOR EACH ROW EXECUTE FUNCTION hh_validate_json_text('skill_versions_json','model_versions_json','protected_trace_refs_json','payload_json');
--> statement-breakpoint
CREATE TRIGGER candidate_source_claims_json BEFORE INSERT ON candidate_source_claims FOR EACH ROW EXECUTE FUNCTION hh_validate_json_text('locator_json','criterion_ids_json');
--> statement-breakpoint
CREATE TRIGGER candidate_evidence_conflicts_json BEFORE INSERT ON candidate_evidence_conflicts FOR EACH ROW EXECUTE FUNCTION hh_validate_json_text('claim_ids_json');
--> statement-breakpoint
CREATE TRIGGER candidate_matrix_rows_json BEFORE INSERT ON candidate_matrix_rows FOR EACH ROW EXECUTE FUNCTION hh_validate_json_text('supporting_claim_ids_json','contradicting_claim_ids_json','checked_source_ids_json');
--> statement-breakpoint

CREATE OR REPLACE FUNCTION hh_validate_matrix_candidate_scope() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM agent_runs run
    JOIN agent_goals goal ON goal.id=run.goal_id
    JOIN candidate_input_versions input_version ON input_version.id=NEW.input_version_id
    WHERE run.id=NEW.run_id
      AND goal.candidate_id=NEW.candidate_id
      AND input_version.candidate_id=NEW.candidate_id
      AND goal.input_version=NEW.input_version_id
      AND goal.profile_version=NEW.profile_version
  ) THEN
    RAISE EXCEPTION 'MATRIX_CANDIDATE_SCOPE_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER candidate_source_claims_scope BEFORE INSERT ON candidate_source_claims FOR EACH ROW EXECUTE FUNCTION hh_validate_matrix_candidate_scope();
--> statement-breakpoint
CREATE TRIGGER candidate_evidence_conflicts_scope BEFORE INSERT ON candidate_evidence_conflicts FOR EACH ROW EXECUTE FUNCTION hh_validate_matrix_candidate_scope();
--> statement-breakpoint
CREATE TRIGGER candidate_matrix_rows_scope BEFORE INSERT ON candidate_matrix_rows FOR EACH ROW EXECUTE FUNCTION hh_validate_matrix_candidate_scope();
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS candidate_source_claims_scope_idx ON candidate_source_claims(candidate_id,run_id,input_version_id,profile_version);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS candidate_evidence_conflicts_scope_idx ON candidate_evidence_conflicts(candidate_id,run_id,input_version_id,profile_version);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS candidate_matrix_rows_scope_idx ON candidate_matrix_rows(candidate_id,run_id,input_version_id,profile_version);
