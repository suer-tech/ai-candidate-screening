CREATE TABLE "agent_artifact_refs" (
	"id" text PRIMARY KEY NOT NULL,
	"memory_entry_id" text NOT NULL,
	"storage_class" text NOT NULL,
	"storage_identity" text NOT NULL,
	"checksum" text NOT NULL,
	"schema_version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"lease_owner" text NOT NULL,
	"lease_token" integer NOT NULL,
	"state" text NOT NULL,
	"unknown_outcome" boolean DEFAULT false NOT NULL,
	"started_at" text NOT NULL,
	"finished_at" text,
	"error_code" text
);
--> statement-breakpoint
CREATE TABLE "agent_budget_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"kind" text NOT NULL,
	"limit_value" integer NOT NULL,
	"used_value" integer DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "agent_budget_nonnegative" CHECK ("agent_budget_ledger"."limit_value" > 0 AND "agent_budget_ledger"."used_value" >= 0 AND "agent_budget_ledger"."used_value" <= "agent_budget_ledger"."limit_value")
);
--> statement-breakpoint
CREATE TABLE "agent_budget_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"ledger_id" text NOT NULL,
	"operation_identity" text NOT NULL,
	"amount" integer NOT NULL,
	"state" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "agent_budget_reservation_positive" CHECK ("agent_budget_reservations"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "agent_checkpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"attempt_id" text NOT NULL,
	"lease_token" integer NOT NULL,
	"kind" text NOT NULL,
	"identity" text NOT NULL,
	"remote_job_id" text,
	"artifact_identity" text,
	"checksum" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_compensations" (
	"id" text PRIMARY KEY NOT NULL,
	"outbox_id" text NOT NULL,
	"operation_identity" text NOT NULL,
	"state" text NOT NULL,
	"outcome_json" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_escalation_actions" (
	"escalation_id" text NOT NULL,
	"action_key" text NOT NULL,
	"schema_version" text NOT NULL,
	"schema_json" text NOT NULL,
	"changes_immutable_inputs" boolean NOT NULL,
	CONSTRAINT "agent_escalation_actions_escalation_id_action_key_schema_version_pk" PRIMARY KEY("escalation_id","action_key","schema_version")
);
--> statement-breakpoint
CREATE TABLE "agent_escalations" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"version" integer NOT NULL,
	"state" text NOT NULL,
	"obstacle_fingerprint" text NOT NULL,
	"safe_summary" text NOT NULL,
	"impact" text NOT NULL,
	"attempts_json" text NOT NULL,
	"budgets_json" text NOT NULL,
	"evidence_refs_json" text NOT NULL,
	"reusable_artifacts_json" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_eval_results" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"policy_version" text NOT NULL,
	"evaluator_version" text NOT NULL,
	"decision" text NOT NULL,
	"input_artifacts_json" text NOT NULL,
	"violations_json" text NOT NULL,
	"evidence_refs_json" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_events" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"event_identity" text NOT NULL,
	"type" text NOT NULL,
	"actor" text NOT NULL,
	"plan_version" integer NOT NULL,
	"task_id" text,
	"safe_payload_json" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_goals" (
	"id" text PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"goal_type" text NOT NULL,
	"input_version" text NOT NULL,
	"profile_version" text NOT NULL,
	"policy_version" text NOT NULL,
	"completion_criteria_version" text NOT NULL,
	"completion_criteria_json" text NOT NULL,
	"state" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "agent_goals_revision_positive" CHECK ("agent_goals"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "agent_memory_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"goal_id" text NOT NULL,
	"run_id" text NOT NULL,
	"candidate_id" integer NOT NULL,
	"input_version" text NOT NULL,
	"profile_version" text NOT NULL,
	"kind" text NOT NULL,
	"provenance" text NOT NULL,
	"sensitivity" text NOT NULL,
	"purpose" text NOT NULL,
	"payload_json" text,
	"superseded_at" text,
	"immutable" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_obstacle_fingerprints" (
	"run_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"evidence_revision" text NOT NULL,
	"repair_count" integer DEFAULT 0 NOT NULL,
	"replan_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "agent_obstacle_fingerprints_run_id_fingerprint_evidence_revision_pk" PRIMARY KEY("run_id","fingerprint","evidence_revision")
);
--> statement-breakpoint
CREATE TABLE "agent_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"operation_identity" text NOT NULL,
	"side_effect_class" text NOT NULL,
	"state" text NOT NULL,
	"payload_ref" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"unknown_outcome" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_plan_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"version" integer NOT NULL,
	"reason" text NOT NULL,
	"obstacle_fingerprint" text,
	"mapping_json" text,
	"plan_json" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "agent_plan_versions_version_positive" CHECK ("agent_plan_versions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"goal_id" text NOT NULL,
	"trigger_identity" text NOT NULL,
	"origin_escalation_id" text,
	"state" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"current_plan_version" integer DEFAULT 1 NOT NULL,
	"last_progress_at" text NOT NULL,
	CONSTRAINT "agent_runs_revision_positive" CHECK ("agent_runs"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "agent_task_dependencies" (
	"task_id" text NOT NULL,
	"depends_on_task_id" text NOT NULL,
	"required_outcome" text DEFAULT 'SUCCEEDED' NOT NULL,
	CONSTRAINT "agent_task_dependencies_task_id_depends_on_task_id_pk" PRIMARY KEY("task_id","depends_on_task_id"),
	CONSTRAINT "agent_task_dependency_not_self" CHECK ("agent_task_dependencies"."task_id" <> "agent_task_dependencies"."depends_on_task_id")
);
--> statement-breakpoint
CREATE TABLE "agent_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"plan_version_id" text NOT NULL,
	"task_key" text NOT NULL,
	"tool_key" text NOT NULL,
	"state" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"lease_owner" text,
	"lease_token" integer DEFAULT 0 NOT NULL,
	"lease_expires_at" bigint,
	"idempotency_identity" text NOT NULL,
	"preconditions_json" text NOT NULL,
	"expected_outputs_json" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_tool_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"candidate_id" integer NOT NULL,
	"run_id" text NOT NULL,
	"input_version" text NOT NULL,
	"policy_version" text NOT NULL,
	"tool_key" text NOT NULL,
	"operations_json" text NOT NULL,
	"side_effect_class" text NOT NULL,
	"budget_link" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"revoked_at" bigint
);
--> statement-breakpoint
CREATE TABLE "artifact_blobs" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"kind" text NOT NULL,
	"checksum" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"content" "bytea" NOT NULL,
	"retention_until_utc" text,
	"protected" boolean DEFAULT false NOT NULL,
	"created_at_utc" text NOT NULL,
	CONSTRAINT "artifact_blobs_checksum_sha256" CHECK ("artifact_blobs"."checksum" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "artifact_blobs_size_global" CHECK ("artifact_blobs"."byte_size" > 0 AND "artifact_blobs"."byte_size" <= 33554432)
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"action" text NOT NULL,
	"actor" text NOT NULL,
	"timestamp" text NOT NULL,
	"outcome" text NOT NULL,
	"details" text
);
--> statement-breakpoint
CREATE TABLE "candidate_assessments" (
	"id" text PRIMARY KEY NOT NULL,
	"artifact_id" text NOT NULL,
	"predecessor_id" text,
	"attempt" integer NOT NULL,
	"recommendation" text NOT NULL,
	"formula_version" text NOT NULL,
	"gate_state" text NOT NULL,
	"decision_evidence_json" text NOT NULL,
	CONSTRAINT "candidate_assessment_attempt_positive" CHECK ("candidate_assessments"."attempt" > 0)
);
--> statement-breakpoint
CREATE TABLE "candidate_cleanup_states" (
	"candidate_id" integer PRIMARY KEY NOT NULL,
	"drive_folder_id" text NOT NULL,
	"state" text NOT NULL,
	"confirmations_json" text NOT NULL,
	"deleted_at_utc" text
);
--> statement-breakpoint
CREATE TABLE "candidate_domain_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"run_id" text NOT NULL,
	"input_version_id" text NOT NULL,
	"profile_version" text NOT NULL,
	"kind" text NOT NULL,
	"schema_version" text NOT NULL,
	"provider" text,
	"tool_version" text NOT NULL,
	"config_fingerprint" text NOT NULL,
	"protected_trace_id" text,
	"parent_artifact_id" text,
	"checksum" text NOT NULL,
	"payload_ref" text NOT NULL,
	"created_at_utc" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_drive_folder_tombstones" (
	"drive_folder_id" text PRIMARY KEY NOT NULL,
	"deleted_at_utc" text NOT NULL,
	"cleanup_evidence_json" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_drive_folders" (
	"drive_folder_id" text PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"vacancy_folder_id" text NOT NULL,
	"display_name" text NOT NULL,
	"parent_path" text NOT NULL,
	"first_seen_at_utc" text NOT NULL,
	"last_seen_at_utc" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_drive_objects" (
	"id" text PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"drive_folder_id" text NOT NULL,
	"drive_file_id" text NOT NULL,
	"provider_version" text NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"modified_at_utc" text NOT NULL,
	"in_results_subtree" boolean DEFAULT false NOT NULL,
	CONSTRAINT "candidate_drive_object_size_nonnegative" CHECK ("candidate_drive_objects"."size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "candidate_evidence_locators" (
	"id" text PRIMARY KEY NOT NULL,
	"artifact_id" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_identity" text NOT NULL,
	"source_version" text NOT NULL,
	"exact_text" text NOT NULL,
	"locator_json" text NOT NULL,
	"confidence_micros" integer,
	CONSTRAINT "candidate_locator_confidence" CHECK ("candidate_evidence_locators"."confidence_micros" IS NULL OR ("candidate_evidence_locators"."confidence_micros" >= 0 AND "candidate_evidence_locators"."confidence_micros" <= 1000000))
);
--> statement-breakpoint
CREATE TABLE "candidate_facts" (
	"id" text PRIMARY KEY NOT NULL,
	"artifact_id" text NOT NULL,
	"locator_id" text NOT NULL,
	"predicate" text NOT NULL,
	"value_json" text NOT NULL,
	"significant" boolean NOT NULL,
	"conflict_group" text
);
--> statement-breakpoint
CREATE TABLE "candidate_input_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"snapshot_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"manifest_json" text NOT NULL,
	"state" text NOT NULL,
	"created_at_utc" text NOT NULL,
	CONSTRAINT "candidate_input_sequence_positive" CHECK ("candidate_input_versions"."sequence" > 0)
);
--> statement-breakpoint
CREATE TABLE "candidate_material_entries" (
	"input_version_id" text NOT NULL,
	"drive_object_id" text NOT NULL,
	"role" text NOT NULL,
	"supported" boolean NOT NULL,
	CONSTRAINT "candidate_material_entries_input_version_id_drive_object_id_pk" PRIMARY KEY("input_version_id","drive_object_id")
);
--> statement-breakpoint
CREATE TABLE "candidate_material_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"complete" boolean NOT NULL,
	"stable_comparisons" integer DEFAULT 0 NOT NULL,
	"captured_at_utc" text NOT NULL,
	CONSTRAINT "candidate_snapshot_stability_bounded" CHECK ("candidate_material_snapshots"."stable_comparisons" >= 0 AND "candidate_material_snapshots"."stable_comparisons" <= 3)
);
--> statement-breakpoint
CREATE TABLE "candidate_notification_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"recipient_ref" text NOT NULL,
	"state" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"provider_message_id" text,
	"next_attempt_at_utc" text,
	CONSTRAINT "candidate_notification_attempts_nonnegative" CHECK ("candidate_notification_deliveries"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "candidate_notification_events" (
	"id" text PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"run_id" text NOT NULL,
	"logical_key" text NOT NULL,
	"type" text NOT NULL,
	"safe_payload_json" text NOT NULL,
	"created_at_utc" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_report_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"report_version_id" text NOT NULL,
	"type" text NOT NULL,
	"file_name" text NOT NULL,
	"checksum" text NOT NULL,
	"byte_size" integer NOT NULL,
	"drive_file_id" text,
	"validation_json" text NOT NULL,
	CONSTRAINT "candidate_report_document_size_positive" CHECK ("candidate_report_documents"."byte_size" > 0)
);
--> statement-breakpoint
CREATE TABLE "candidate_report_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"run_id" text NOT NULL,
	"assessment_id" text NOT NULL,
	"analysis_version" integer NOT NULL,
	"state" text NOT NULL,
	"directory_identity" text NOT NULL,
	CONSTRAINT "candidate_report_analysis_version_positive" CHECK ("candidate_report_versions"."analysis_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "candidate_stage_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"run_id" text NOT NULL,
	"stage" text NOT NULL,
	"config_fingerprint" text NOT NULL,
	"started_at_utc" text NOT NULL,
	"ended_at_utc" text,
	"duration_ms" integer,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"outcome" text NOT NULL,
	CONSTRAINT "candidate_stage_metric_duration_nonnegative" CHECK ("candidate_stage_metrics"."duration_ms" IS NULL OR "candidate_stage_metrics"."duration_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "candidate_tombstones" (
	"candidate_id" integer PRIMARY KEY NOT NULL,
	"deleted_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidates" (
	"id" integer PRIMARY KEY NOT NULL,
	"public_id" text,
	"revision" integer NOT NULL,
	"record_json" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_drive_oauth_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text,
	"principal_id" text NOT NULL,
	"event_type" text NOT NULL,
	"safe_code" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_drive_oauth_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"singleton_key" text DEFAULT 'primary' NOT NULL,
	"state" text NOT NULL,
	"owner_subject" text NOT NULL,
	"owner_email" text NOT NULL,
	"scopes_json" text NOT NULL,
	"root_folder_id" text NOT NULL,
	"root_folder_name" text DEFAULT 'Найм' NOT NULL,
	"deployment_mode" text NOT NULL,
	"token_ciphertext" text,
	"token_nonce" text,
	"token_tag" text,
	"token_key_version" text,
	"connected_at" text NOT NULL,
	"last_refresh_at" text,
	"reauth_required_at" text,
	"disconnected_at" text,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "google_drive_oauth_connection_revision_positive" CHECK ("google_drive_oauth_connections"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "google_drive_oauth_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"state_hash" text NOT NULL,
	"principal_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"return_path" text NOT NULL,
	"verifier_ciphertext" text NOT NULL,
	"verifier_nonce" text NOT NULL,
	"verifier_tag" text NOT NULL,
	"verifier_key_version" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"consumed_at" bigint,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_drive_registered_objects" (
	"connection_id" text NOT NULL,
	"file_id" text NOT NULL,
	"parent_id" text,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"operation_identity" text,
	"checksum" text,
	"discovered_at" text NOT NULL,
	CONSTRAINT "google_drive_registered_objects_connection_id_file_id_pk" PRIMARY KEY("connection_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "result_documents" (
	"candidate_id" integer NOT NULL,
	"type" text NOT NULL,
	"version" integer NOT NULL,
	"descriptor_json" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vacancies" (
	"id" text PRIMARY KEY NOT NULL,
	"normalized_title" text NOT NULL,
	"record_json" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vacancy_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"operation_id" text NOT NULL,
	"event_type" text NOT NULL,
	"attempt_number" integer,
	"safe_code" text,
	"actor" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vacancy_generation_attempts" (
	"operation_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"outcome" text NOT NULL,
	"safe_code" text,
	"trace_id" text,
	"created_at" text NOT NULL,
	CONSTRAINT "vacancy_generation_attempts_operation_id_attempt_number_outcome_pk" PRIMARY KEY("operation_id","attempt_number","outcome"),
	CONSTRAINT "vacancy_generation_attempt_number" CHECK ("vacancy_generation_attempts"."attempt_number" > 0 AND "vacancy_generation_attempts"."attempt_number" <= 4)
);
--> statement-breakpoint
CREATE TABLE "vacancy_generation_operations" (
	"operation_id" text PRIMARY KEY NOT NULL,
	"original_title" text NOT NULL,
	"normalized_title" text NOT NULL,
	"state" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"generated_profile_json" text,
	"snapshot_hash" text,
	"error_code" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "vacancy_generation_attempt_count" CHECK ("vacancy_generation_operations"."attempt_count" >= 0 AND "vacancy_generation_operations"."attempt_count" <= 4)
);
--> statement-breakpoint
CREATE TABLE "vacancy_operations" (
	"operation_id" text PRIMARY KEY NOT NULL,
	"vacancy_id" text NOT NULL,
	"normalized_title" text NOT NULL,
	"input_json" text NOT NULL,
	"state" text NOT NULL,
	"folder_id" text
);
--> statement-breakpoint
ALTER TABLE "agent_artifact_refs" ADD CONSTRAINT "agent_artifact_refs_memory_entry_id_agent_memory_entries_id_fk" FOREIGN KEY ("memory_entry_id") REFERENCES "public"."agent_memory_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_attempts" ADD CONSTRAINT "agent_attempts_task_id_agent_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_budget_ledger" ADD CONSTRAINT "agent_budget_ledger_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_budget_reservations" ADD CONSTRAINT "agent_budget_reservations_ledger_id_agent_budget_ledger_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."agent_budget_ledger"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_checkpoints" ADD CONSTRAINT "agent_checkpoints_attempt_id_agent_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."agent_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_compensations" ADD CONSTRAINT "agent_compensations_outbox_id_agent_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."agent_outbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_escalation_actions" ADD CONSTRAINT "agent_escalation_actions_escalation_id_agent_escalations_id_fk" FOREIGN KEY ("escalation_id") REFERENCES "public"."agent_escalations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_escalations" ADD CONSTRAINT "agent_escalations_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_results" ADD CONSTRAINT "agent_eval_results_task_id_agent_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_task_id_agent_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_goals" ADD CONSTRAINT "agent_goals_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory_entries" ADD CONSTRAINT "agent_memory_entries_goal_id_agent_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."agent_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory_entries" ADD CONSTRAINT "agent_memory_entries_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory_entries" ADD CONSTRAINT "agent_memory_entries_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_obstacle_fingerprints" ADD CONSTRAINT "agent_obstacle_fingerprints_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_outbox" ADD CONSTRAINT "agent_outbox_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_plan_versions" ADD CONSTRAINT "agent_plan_versions_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_goal_id_agent_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."agent_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task_dependencies" ADD CONSTRAINT "agent_task_dependencies_task_id_agent_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task_dependencies" ADD CONSTRAINT "agent_task_dependencies_depends_on_task_id_agent_tasks_id_fk" FOREIGN KEY ("depends_on_task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_plan_version_id_agent_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."agent_plan_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_grants" ADD CONSTRAINT "agent_tool_grants_task_id_agent_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_grants" ADD CONSTRAINT "agent_tool_grants_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_grants" ADD CONSTRAINT "agent_tool_grants_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_assessments" ADD CONSTRAINT "candidate_assessments_artifact_id_candidate_domain_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."candidate_domain_artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_cleanup_states" ADD CONSTRAINT "candidate_cleanup_states_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_domain_artifacts" ADD CONSTRAINT "candidate_domain_artifacts_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_domain_artifacts" ADD CONSTRAINT "candidate_domain_artifacts_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_domain_artifacts" ADD CONSTRAINT "candidate_domain_artifacts_input_version_id_candidate_input_versions_id_fk" FOREIGN KEY ("input_version_id") REFERENCES "public"."candidate_input_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_drive_folders" ADD CONSTRAINT "candidate_drive_folders_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_drive_objects" ADD CONSTRAINT "candidate_drive_objects_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_evidence_locators" ADD CONSTRAINT "candidate_evidence_locators_artifact_id_candidate_domain_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."candidate_domain_artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_facts" ADD CONSTRAINT "candidate_facts_artifact_id_candidate_domain_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."candidate_domain_artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_facts" ADD CONSTRAINT "candidate_facts_locator_id_candidate_evidence_locators_id_fk" FOREIGN KEY ("locator_id") REFERENCES "public"."candidate_evidence_locators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_input_versions" ADD CONSTRAINT "candidate_input_versions_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_input_versions" ADD CONSTRAINT "candidate_input_versions_snapshot_id_candidate_material_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."candidate_material_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_material_entries" ADD CONSTRAINT "candidate_material_entries_input_version_id_candidate_input_versions_id_fk" FOREIGN KEY ("input_version_id") REFERENCES "public"."candidate_input_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_material_entries" ADD CONSTRAINT "candidate_material_entries_drive_object_id_candidate_drive_objects_id_fk" FOREIGN KEY ("drive_object_id") REFERENCES "public"."candidate_drive_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_material_snapshots" ADD CONSTRAINT "candidate_material_snapshots_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_notification_deliveries" ADD CONSTRAINT "candidate_notification_deliveries_event_id_candidate_notification_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."candidate_notification_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_notification_events" ADD CONSTRAINT "candidate_notification_events_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_notification_events" ADD CONSTRAINT "candidate_notification_events_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_report_documents" ADD CONSTRAINT "candidate_report_documents_report_version_id_candidate_report_versions_id_fk" FOREIGN KEY ("report_version_id") REFERENCES "public"."candidate_report_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_report_versions" ADD CONSTRAINT "candidate_report_versions_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_report_versions" ADD CONSTRAINT "candidate_report_versions_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_report_versions" ADD CONSTRAINT "candidate_report_versions_assessment_id_candidate_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."candidate_assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_stage_metrics" ADD CONSTRAINT "candidate_stage_metrics_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_stage_metrics" ADD CONSTRAINT "candidate_stage_metrics_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_drive_registered_objects" ADD CONSTRAINT "google_drive_registered_objects_connection_id_google_drive_oauth_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."google_drive_oauth_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancy_generation_attempts" ADD CONSTRAINT "vacancy_generation_attempts_operation_id_vacancy_generation_operations_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."vacancy_generation_operations"("operation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_artifact_identity_unique" ON "agent_artifact_refs" USING btree ("storage_class","storage_identity","checksum");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_attempts_task_number_unique" ON "agent_attempts" USING btree ("task_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_attempts_fencing_unique" ON "agent_attempts" USING btree ("task_id","lease_token");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_budget_ledger_run_kind_unique" ON "agent_budget_ledger" USING btree ("run_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_budget_reservation_operation_unique" ON "agent_budget_reservations" USING btree ("ledger_id","operation_identity");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_checkpoints_attempt_identity_unique" ON "agent_checkpoints" USING btree ("attempt_id","kind","identity");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_compensations_operation_unique" ON "agent_compensations" USING btree ("operation_identity");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_escalations_run_version_unique" ON "agent_escalations" USING btree ("run_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_events_run_sequence_unique" ON "agent_events" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_events_identity_unique" ON "agent_events" USING btree ("event_identity");--> statement-breakpoint
CREATE INDEX "agent_events_lookup_idx" ON "agent_events" USING btree ("run_id","type","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_goals_identity_unique" ON "agent_goals" USING btree ("candidate_id","input_version","profile_version","goal_type");--> statement-breakpoint
CREATE INDEX "agent_goals_candidate_idx" ON "agent_goals" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "agent_memory_scope_idx" ON "agent_memory_entries" USING btree ("candidate_id","run_id","input_version","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_outbox_operation_unique" ON "agent_outbox" USING btree ("operation_identity");--> statement-breakpoint
CREATE INDEX "agent_outbox_dispatch_idx" ON "agent_outbox" USING btree ("state","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_plan_versions_run_version_unique" ON "agent_plan_versions" USING btree ("run_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_trigger_unique" ON "agent_runs" USING btree ("trigger_identity");--> statement-breakpoint
CREATE INDEX "agent_runs_goal_idx" ON "agent_runs" USING btree ("goal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_tasks_plan_key_unique" ON "agent_tasks" USING btree ("plan_version_id","task_key");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_tasks_operation_identity_unique" ON "agent_tasks" USING btree ("idempotency_identity");--> statement-breakpoint
CREATE INDEX "agent_tasks_runnable_claim_idx" ON "agent_tasks" USING btree ("state","lease_expires_at","run_id");--> statement-breakpoint
CREATE INDEX "agent_tasks_stale_lease_idx" ON "agent_tasks" USING btree ("lease_expires_at","lease_token");--> statement-breakpoint
CREATE INDEX "agent_tool_grants_scope_idx" ON "agent_tool_grants" USING btree ("task_id","run_id","input_version","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_blobs_scope_checksum_unique" ON "artifact_blobs" USING btree ("scope","checksum");--> statement-breakpoint
CREATE INDEX "artifact_blobs_retention_idx" ON "artifact_blobs" USING btree ("retention_until_utc","protected");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_cleanup_drive_folder_unique" ON "candidate_cleanup_states" USING btree ("drive_folder_id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_artifact_checksum_unique" ON "candidate_domain_artifacts" USING btree ("candidate_id","kind","checksum");--> statement-breakpoint
CREATE INDEX "candidate_artifact_scope_idx" ON "candidate_domain_artifacts" USING btree ("candidate_id","run_id","input_version_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_drive_folders_candidate_unique" ON "candidate_drive_folders" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "candidate_drive_folders_vacancy_idx" ON "candidate_drive_folders" USING btree ("vacancy_folder_id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_drive_object_version_unique" ON "candidate_drive_objects" USING btree ("candidate_id","drive_file_id","provider_version");--> statement-breakpoint
CREATE INDEX "candidate_drive_folder_idx" ON "candidate_drive_objects" USING btree ("drive_folder_id","drive_file_id");--> statement-breakpoint
CREATE INDEX "candidate_locator_source_idx" ON "candidate_evidence_locators" USING btree ("source_kind","source_identity","source_version");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_input_sequence_unique" ON "candidate_input_versions" USING btree ("candidate_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_snapshot_identity_unique" ON "candidate_material_snapshots" USING btree ("candidate_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_notification_recipient_unique" ON "candidate_notification_deliveries" USING btree ("event_id","recipient_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_notification_logical_key_unique" ON "candidate_notification_events" USING btree ("logical_key");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_report_document_type_unique" ON "candidate_report_documents" USING btree ("report_version_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_report_version_unique" ON "candidate_report_versions" USING btree ("candidate_id","analysis_version");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_stage_metric_unique" ON "candidate_stage_metrics" USING btree ("run_id","stage");--> statement-breakpoint
CREATE UNIQUE INDEX "candidates_public_id_unique" ON "candidates" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "google_drive_oauth_audit_connection_idx" ON "google_drive_oauth_audit_events" USING btree ("connection_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "google_drive_oauth_connection_singleton_unique" ON "google_drive_oauth_connections" USING btree ("singleton_key");--> statement-breakpoint
CREATE INDEX "google_drive_oauth_connection_state_idx" ON "google_drive_oauth_connections" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "google_drive_oauth_operation_state_unique" ON "google_drive_oauth_operations" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX "google_drive_oauth_operation_expiry_idx" ON "google_drive_oauth_operations" USING btree ("expires_at","consumed_at");--> statement-breakpoint
CREATE INDEX "google_drive_registered_parent_idx" ON "google_drive_registered_objects" USING btree ("connection_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "google_drive_registered_operation_unique" ON "google_drive_registered_objects" USING btree ("connection_id","operation_identity");--> statement-breakpoint
CREATE UNIQUE INDEX "result_documents_identity_unique" ON "result_documents" USING btree ("candidate_id","type","version");--> statement-breakpoint
CREATE UNIQUE INDEX "vacancies_normalized_title_unique" ON "vacancies" USING btree ("normalized_title");--> statement-breakpoint
CREATE INDEX "vacancy_audit_operation_idx" ON "vacancy_audit_events" USING btree ("operation_id","created_at");--> statement-breakpoint
CREATE INDEX "vacancy_generation_title_idx" ON "vacancy_generation_operations" USING btree ("normalized_title","state");--> statement-breakpoint
CREATE UNIQUE INDEX "vacancy_operations_normalized_title_unique" ON "vacancy_operations" USING btree ("normalized_title");