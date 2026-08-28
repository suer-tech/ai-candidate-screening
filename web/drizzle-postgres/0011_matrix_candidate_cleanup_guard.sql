DROP TRIGGER IF EXISTS candidate_source_claims_immutable ON candidate_source_claims;
--> statement-breakpoint
CREATE TRIGGER candidate_source_claims_immutable
  BEFORE UPDATE OR DELETE ON candidate_source_claims
  FOR EACH ROW EXECUTE FUNCTION hh_protect_agent_history();
--> statement-breakpoint

DROP TRIGGER IF EXISTS candidate_evidence_conflicts_immutable ON candidate_evidence_conflicts;
--> statement-breakpoint
CREATE TRIGGER candidate_evidence_conflicts_immutable
  BEFORE UPDATE OR DELETE ON candidate_evidence_conflicts
  FOR EACH ROW EXECUTE FUNCTION hh_protect_agent_history();
--> statement-breakpoint

DROP TRIGGER IF EXISTS candidate_matrix_rows_immutable ON candidate_matrix_rows;
--> statement-breakpoint
CREATE TRIGGER candidate_matrix_rows_immutable
  BEFORE UPDATE OR DELETE ON candidate_matrix_rows
  FOR EACH ROW EXECUTE FUNCTION hh_protect_agent_history();
