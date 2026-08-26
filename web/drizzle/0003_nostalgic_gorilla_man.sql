CREATE TABLE `candidate_assessments` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`predecessor_id` text,
	`attempt` integer NOT NULL,
	`recommendation` text NOT NULL,
	`formula_version` text NOT NULL,
	`gate_state` text NOT NULL,
	`decision_evidence_json` text NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `candidate_domain_artifacts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "candidate_assessment_attempt_positive" CHECK("candidate_assessments"."attempt" > 0)
);
--> statement-breakpoint
CREATE TABLE `candidate_cleanup_states` (
	`candidate_id` integer PRIMARY KEY NOT NULL,
	`drive_folder_id` text NOT NULL,
	`state` text NOT NULL,
	`confirmations_json` text NOT NULL,
	`deleted_at_utc` text,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_cleanup_drive_folder_unique` ON `candidate_cleanup_states` (`drive_folder_id`);--> statement-breakpoint
CREATE TABLE `candidate_domain_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` integer NOT NULL,
	`run_id` text NOT NULL,
	`input_version_id` text NOT NULL,
	`profile_version` text NOT NULL,
	`kind` text NOT NULL,
	`schema_version` text NOT NULL,
	`provider` text,
	`tool_version` text NOT NULL,
	`config_fingerprint` text NOT NULL,
	`protected_trace_id` text,
	`parent_artifact_id` text,
	`checksum` text NOT NULL,
	`payload_ref` text NOT NULL,
	`created_at_utc` text NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`input_version_id`) REFERENCES `candidate_input_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_artifact_checksum_unique` ON `candidate_domain_artifacts` (`candidate_id`,`kind`,`checksum`);--> statement-breakpoint
CREATE INDEX `candidate_artifact_scope_idx` ON `candidate_domain_artifacts` (`candidate_id`,`run_id`,`input_version_id`,`kind`);--> statement-breakpoint
CREATE TABLE `candidate_drive_objects` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` integer NOT NULL,
	`drive_folder_id` text NOT NULL,
	`drive_file_id` text NOT NULL,
	`provider_version` text NOT NULL,
	`name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`modified_at_utc` text NOT NULL,
	`in_results_subtree` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "candidate_drive_object_size_nonnegative" CHECK("candidate_drive_objects"."size" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_drive_object_version_unique` ON `candidate_drive_objects` (`candidate_id`,`drive_file_id`,`provider_version`);--> statement-breakpoint
CREATE INDEX `candidate_drive_folder_idx` ON `candidate_drive_objects` (`drive_folder_id`,`drive_file_id`);--> statement-breakpoint
CREATE TABLE `candidate_evidence_locators` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_identity` text NOT NULL,
	`source_version` text NOT NULL,
	`exact_text` text NOT NULL,
	`locator_json` text NOT NULL,
	`confidence_micros` integer,
	FOREIGN KEY (`artifact_id`) REFERENCES `candidate_domain_artifacts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "candidate_locator_confidence" CHECK("candidate_evidence_locators"."confidence_micros" IS NULL OR ("candidate_evidence_locators"."confidence_micros" >= 0 AND "candidate_evidence_locators"."confidence_micros" <= 1000000))
);
--> statement-breakpoint
CREATE INDEX `candidate_locator_source_idx` ON `candidate_evidence_locators` (`source_kind`,`source_identity`,`source_version`);--> statement-breakpoint
CREATE TABLE `candidate_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`locator_id` text NOT NULL,
	`predicate` text NOT NULL,
	`value_json` text NOT NULL,
	`significant` integer NOT NULL,
	`conflict_group` text,
	FOREIGN KEY (`artifact_id`) REFERENCES `candidate_domain_artifacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`locator_id`) REFERENCES `candidate_evidence_locators`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `candidate_input_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` integer NOT NULL,
	`snapshot_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`manifest_json` text NOT NULL,
	`state` text NOT NULL,
	`created_at_utc` text NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`snapshot_id`) REFERENCES `candidate_material_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "candidate_input_sequence_positive" CHECK("candidate_input_versions"."sequence" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_input_sequence_unique` ON `candidate_input_versions` (`candidate_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `candidate_material_entries` (
	`input_version_id` text NOT NULL,
	`drive_object_id` text NOT NULL,
	`role` text NOT NULL,
	`supported` integer NOT NULL,
	PRIMARY KEY(`input_version_id`, `drive_object_id`),
	FOREIGN KEY (`input_version_id`) REFERENCES `candidate_input_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`drive_object_id`) REFERENCES `candidate_drive_objects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `candidate_material_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`complete` integer NOT NULL,
	`stable_comparisons` integer DEFAULT 0 NOT NULL,
	`captured_at_utc` text NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "candidate_snapshot_stability_bounded" CHECK("candidate_material_snapshots"."stable_comparisons" >= 0 AND "candidate_material_snapshots"."stable_comparisons" <= 3)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_snapshot_identity_unique` ON `candidate_material_snapshots` (`candidate_id`,`id`);--> statement-breakpoint
CREATE TABLE `candidate_notification_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`recipient_ref` text NOT NULL,
	`state` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`provider_message_id` text,
	`next_attempt_at_utc` text,
	FOREIGN KEY (`event_id`) REFERENCES `candidate_notification_events`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "candidate_notification_attempts_nonnegative" CHECK("candidate_notification_deliveries"."attempts" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_notification_recipient_unique` ON `candidate_notification_deliveries` (`event_id`,`recipient_ref`);--> statement-breakpoint
CREATE TABLE `candidate_notification_events` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` integer NOT NULL,
	`run_id` text NOT NULL,
	`logical_key` text NOT NULL,
	`type` text NOT NULL,
	`safe_payload_json` text NOT NULL,
	`created_at_utc` text NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_notification_logical_key_unique` ON `candidate_notification_events` (`logical_key`);--> statement-breakpoint
CREATE TABLE `candidate_report_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`report_version_id` text NOT NULL,
	`type` text NOT NULL,
	`file_name` text NOT NULL,
	`checksum` text NOT NULL,
	`byte_size` integer NOT NULL,
	`drive_file_id` text,
	`validation_json` text NOT NULL,
	FOREIGN KEY (`report_version_id`) REFERENCES `candidate_report_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "candidate_report_document_size_positive" CHECK("candidate_report_documents"."byte_size" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_report_document_type_unique` ON `candidate_report_documents` (`report_version_id`,`type`);--> statement-breakpoint
CREATE TABLE `candidate_report_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` integer NOT NULL,
	`run_id` text NOT NULL,
	`assessment_id` text NOT NULL,
	`analysis_version` integer NOT NULL,
	`state` text NOT NULL,
	`directory_identity` text NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assessment_id`) REFERENCES `candidate_assessments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "candidate_report_analysis_version_positive" CHECK("candidate_report_versions"."analysis_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_report_version_unique` ON `candidate_report_versions` (`candidate_id`,`analysis_version`);--> statement-breakpoint
CREATE TABLE `candidate_stage_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` integer NOT NULL,
	`run_id` text NOT NULL,
	`stage` text NOT NULL,
	`config_fingerprint` text NOT NULL,
	`started_at_utc` text NOT NULL,
	`ended_at_utc` text,
	`duration_ms` integer,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`outcome` text NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "candidate_stage_metric_duration_nonnegative" CHECK("candidate_stage_metrics"."duration_ms" IS NULL OR "candidate_stage_metrics"."duration_ms" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_stage_metric_unique` ON `candidate_stage_metrics` (`run_id`,`stage`);
--> statement-breakpoint
CREATE TRIGGER candidate_input_versions_immutable
BEFORE UPDATE ON candidate_input_versions
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_INPUT_VERSION');
END;
--> statement-breakpoint
CREATE TRIGGER candidate_domain_artifacts_immutable
BEFORE UPDATE ON candidate_domain_artifacts
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_DOMAIN_ARTIFACT');
END;
--> statement-breakpoint
CREATE TRIGGER candidate_assessments_immutable
BEFORE UPDATE ON candidate_assessments
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_ASSESSMENT');
END;
--> statement-breakpoint
CREATE TRIGGER candidate_report_documents_immutable
BEFORE UPDATE ON candidate_report_documents
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_REPORT_DOCUMENT');
END;
--> statement-breakpoint
CREATE TRIGGER candidate_report_pair_ready_gate
BEFORE UPDATE OF state ON candidate_report_versions
WHEN NEW.state = 'READY' AND (
  SELECT COUNT(DISTINCT type)
  FROM candidate_report_documents
  WHERE report_version_id = NEW.id
    AND type IN ('abc-test', 'candidate-results')
) <> 2
BEGIN
  SELECT RAISE(ABORT, 'REPORT_PAIR_INCOMPLETE');
END;
