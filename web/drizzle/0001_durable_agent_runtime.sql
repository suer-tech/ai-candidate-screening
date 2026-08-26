PRAGMA foreign_keys = ON;
--> statement-breakpoint
CREATE TABLE `agent_goals` (`id` text PRIMARY KEY NOT NULL, `candidate_id` integer NOT NULL REFERENCES `candidates`(`id`) ON DELETE CASCADE, `goal_type` text NOT NULL, `input_version` text NOT NULL, `profile_version` text NOT NULL, `policy_version` text NOT NULL, `completion_criteria_version` text NOT NULL, `completion_criteria_json` text NOT NULL CHECK(json_valid(`completion_criteria_json`)), `state` text NOT NULL CHECK(`state` IN ('ACTIVE','WAITING_FOR_HUMAN','SUCCEEDED','FAILED','CANCELLED','SUPERSEDED','PAUSED')), `revision` integer NOT NULL DEFAULT 1 CHECK(`revision` > 0), `created_at` text NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_goals_identity_unique` ON `agent_goals` (`candidate_id`,`input_version`,`profile_version`,`goal_type`);
--> statement-breakpoint
CREATE INDEX `agent_goals_candidate_idx` ON `agent_goals` (`candidate_id`);
--> statement-breakpoint
CREATE TABLE `agent_runs` (`id` text PRIMARY KEY NOT NULL, `goal_id` text NOT NULL REFERENCES `agent_goals`(`id`) ON DELETE CASCADE, `trigger_identity` text NOT NULL UNIQUE, `origin_escalation_id` text, `state` text NOT NULL CHECK(`state` IN ('ACTIVE','WAITING_FOR_HUMAN','SUCCEEDED','FAILED','CANCELLED','SUPERSEDED','PAUSED')), `revision` integer NOT NULL DEFAULT 1 CHECK(`revision` > 0), `current_plan_version` integer NOT NULL DEFAULT 1 CHECK(`current_plan_version` > 0), `last_progress_at` text NOT NULL);
--> statement-breakpoint
CREATE INDEX `agent_runs_goal_idx` ON `agent_runs` (`goal_id`);
--> statement-breakpoint
CREATE TABLE `agent_plan_versions` (`id` text PRIMARY KEY NOT NULL, `run_id` text NOT NULL REFERENCES `agent_runs`(`id`) ON DELETE CASCADE, `version` integer NOT NULL CHECK(`version` > 0), `reason` text NOT NULL, `obstacle_fingerprint` text, `mapping_json` text CHECK(`mapping_json` IS NULL OR json_valid(`mapping_json`)), `plan_json` text NOT NULL CHECK(json_valid(`plan_json`)), `created_at` text NOT NULL, UNIQUE(`run_id`,`version`));
--> statement-breakpoint
CREATE TABLE `agent_tasks` (`id` text PRIMARY KEY NOT NULL, `run_id` text NOT NULL REFERENCES `agent_runs`(`id`) ON DELETE CASCADE, `plan_version_id` text NOT NULL REFERENCES `agent_plan_versions`(`id`) ON DELETE CASCADE, `task_key` text NOT NULL, `tool_key` text NOT NULL, `state` text NOT NULL CHECK(`state` IN ('PENDING','RUNNABLE','RUNNING','WAITING','SUCCEEDED','FAILED','CANCELLED','UNKNOWN_OUTCOME')), `revision` integer NOT NULL DEFAULT 1 CHECK(`revision` > 0), `attempt_count` integer NOT NULL DEFAULT 0 CHECK(`attempt_count` >= 0), `lease_owner` text, `lease_token` integer NOT NULL DEFAULT 0 CHECK(`lease_token` >= 0), `lease_expires_at` integer, `idempotency_identity` text NOT NULL UNIQUE, `preconditions_json` text NOT NULL CHECK(json_valid(`preconditions_json`)), `expected_outputs_json` text NOT NULL CHECK(json_valid(`expected_outputs_json`)), UNIQUE(`plan_version_id`,`task_key`));
--> statement-breakpoint
CREATE INDEX `agent_tasks_runnable_claim_idx` ON `agent_tasks` (`state`,`lease_expires_at`,`run_id`);
--> statement-breakpoint
CREATE INDEX `agent_tasks_stale_lease_idx` ON `agent_tasks` (`lease_expires_at`,`lease_token`);
--> statement-breakpoint
CREATE TABLE `agent_task_dependencies` (`task_id` text NOT NULL REFERENCES `agent_tasks`(`id`) ON DELETE CASCADE, `depends_on_task_id` text NOT NULL REFERENCES `agent_tasks`(`id`) ON DELETE CASCADE, `required_outcome` text NOT NULL DEFAULT 'SUCCEEDED', PRIMARY KEY(`task_id`,`depends_on_task_id`), CHECK(`task_id` <> `depends_on_task_id`));
--> statement-breakpoint
CREATE TABLE `agent_attempts` (`id` text PRIMARY KEY NOT NULL, `task_id` text NOT NULL REFERENCES `agent_tasks`(`id`) ON DELETE CASCADE, `attempt_number` integer NOT NULL CHECK(`attempt_number` > 0), `lease_owner` text NOT NULL, `lease_token` integer NOT NULL CHECK(`lease_token` > 0), `state` text NOT NULL, `unknown_outcome` integer NOT NULL DEFAULT 0 CHECK(`unknown_outcome` IN (0,1)), `started_at` text NOT NULL, `finished_at` text, `error_code` text, UNIQUE(`task_id`,`attempt_number`), UNIQUE(`task_id`,`lease_token`));
--> statement-breakpoint
CREATE TABLE `agent_events` (`id` text PRIMARY KEY NOT NULL, `run_id` text NOT NULL REFERENCES `agent_runs`(`id`) ON DELETE CASCADE, `sequence` integer NOT NULL CHECK(`sequence` > 0), `event_identity` text NOT NULL UNIQUE, `type` text NOT NULL, `actor` text NOT NULL, `plan_version` integer NOT NULL CHECK(`plan_version` > 0), `task_id` text REFERENCES `agent_tasks`(`id`) ON DELETE SET NULL, `safe_payload_json` text NOT NULL CHECK(json_valid(`safe_payload_json`)), `created_at` text NOT NULL, UNIQUE(`run_id`,`sequence`));
--> statement-breakpoint
CREATE INDEX `agent_events_lookup_idx` ON `agent_events` (`run_id`,`type`,`sequence`);
--> statement-breakpoint
CREATE TRIGGER `agent_events_immutable_update` BEFORE UPDATE ON `agent_events` BEGIN SELECT RAISE(ABORT, 'agent_events are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `agent_events_immutable_delete` BEFORE DELETE ON `agent_events` WHEN EXISTS (SELECT 1 FROM `agent_runs` r JOIN `agent_goals` g ON g.`id` = r.`goal_id` WHERE r.`id` = OLD.`run_id` AND NOT EXISTS (SELECT 1 FROM `candidate_tombstones` t WHERE t.`candidate_id` = g.`candidate_id`)) BEGIN SELECT RAISE(ABORT, 'agent_events are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `agent_plan_versions_immutable_update` BEFORE UPDATE ON `agent_plan_versions` BEGIN SELECT RAISE(ABORT, 'agent plan versions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `agent_plan_versions_immutable_delete` BEFORE DELETE ON `agent_plan_versions` WHEN EXISTS (SELECT 1 FROM `agent_runs` r JOIN `agent_goals` g ON g.`id` = r.`goal_id` WHERE r.`id` = OLD.`run_id` AND NOT EXISTS (SELECT 1 FROM `candidate_tombstones` t WHERE t.`candidate_id` = g.`candidate_id`)) BEGIN SELECT RAISE(ABORT, 'agent plan versions are immutable'); END;
--> statement-breakpoint
CREATE TABLE `agent_checkpoints` (`id` text PRIMARY KEY NOT NULL, `attempt_id` text NOT NULL REFERENCES `agent_attempts`(`id`) ON DELETE CASCADE, `lease_token` integer NOT NULL CHECK(`lease_token` > 0), `kind` text NOT NULL, `identity` text NOT NULL, `remote_job_id` text, `artifact_identity` text, `checksum` text, `created_at` text NOT NULL, UNIQUE(`attempt_id`,`kind`,`identity`));
--> statement-breakpoint
CREATE TABLE `agent_memory_entries` (`id` text PRIMARY KEY NOT NULL, `goal_id` text NOT NULL REFERENCES `agent_goals`(`id`) ON DELETE CASCADE, `run_id` text NOT NULL REFERENCES `agent_runs`(`id`) ON DELETE CASCADE, `candidate_id` integer NOT NULL REFERENCES `candidates`(`id`) ON DELETE CASCADE, `input_version` text NOT NULL, `profile_version` text NOT NULL, `kind` text NOT NULL CHECK(`kind` IN ('working','artifact','evidence','decision','event','policy')), `provenance` text NOT NULL, `sensitivity` text NOT NULL CHECK(`sensitivity` IN ('personal','confidential','non-personal-policy')), `purpose` text NOT NULL, `payload_json` text CHECK(`payload_json` IS NULL OR json_valid(`payload_json`)), `superseded_at` text, `immutable` integer NOT NULL CHECK(`immutable` IN (0,1)));
--> statement-breakpoint
CREATE INDEX `agent_memory_scope_idx` ON `agent_memory_entries` (`candidate_id`,`run_id`,`input_version`,`purpose`);
--> statement-breakpoint
CREATE TABLE `agent_artifact_refs` (`id` text PRIMARY KEY NOT NULL, `memory_entry_id` text NOT NULL REFERENCES `agent_memory_entries`(`id`) ON DELETE CASCADE, `storage_class` text NOT NULL CHECK(`storage_class` IN ('drive','r2')), `storage_identity` text NOT NULL, `checksum` text NOT NULL, `schema_version` text NOT NULL, UNIQUE(`storage_class`,`storage_identity`,`checksum`));
--> statement-breakpoint
CREATE TABLE `agent_tool_grants` (`id` text PRIMARY KEY NOT NULL, `task_id` text NOT NULL REFERENCES `agent_tasks`(`id`) ON DELETE CASCADE, `candidate_id` integer NOT NULL REFERENCES `candidates`(`id`) ON DELETE CASCADE, `run_id` text NOT NULL REFERENCES `agent_runs`(`id`) ON DELETE CASCADE, `input_version` text NOT NULL, `policy_version` text NOT NULL, `tool_key` text NOT NULL, `operations_json` text NOT NULL CHECK(json_valid(`operations_json`)), `side_effect_class` text NOT NULL CHECK(`side_effect_class` IN ('read-only','idempotent-write','reversible-write','irreversible-write')), `budget_link` text NOT NULL, `expires_at` integer NOT NULL, `revoked_at` integer);
--> statement-breakpoint
CREATE INDEX `agent_tool_grants_scope_idx` ON `agent_tool_grants` (`task_id`,`run_id`,`input_version`,`expires_at`);
--> statement-breakpoint
CREATE TABLE `agent_budget_ledger` (`id` text PRIMARY KEY NOT NULL, `run_id` text NOT NULL REFERENCES `agent_runs`(`id`) ON DELETE CASCADE, `kind` text NOT NULL, `limit_value` integer NOT NULL CHECK(`limit_value` > 0), `used_value` integer NOT NULL DEFAULT 0 CHECK(`used_value` >= 0 AND `used_value` <= `limit_value`), `revision` integer NOT NULL DEFAULT 1 CHECK(`revision` > 0), UNIQUE(`run_id`,`kind`));
--> statement-breakpoint
CREATE TABLE `agent_budget_reservations` (`id` text PRIMARY KEY NOT NULL, `ledger_id` text NOT NULL REFERENCES `agent_budget_ledger`(`id`) ON DELETE CASCADE, `operation_identity` text NOT NULL, `amount` integer NOT NULL CHECK(`amount` > 0), `state` text NOT NULL CHECK(`state` IN ('RESERVED','COMMITTED','RELEASED','UNKNOWN')), `created_at` text NOT NULL, UNIQUE(`ledger_id`,`operation_identity`));
--> statement-breakpoint
CREATE TABLE `agent_eval_results` (`id` text PRIMARY KEY NOT NULL, `task_id` text NOT NULL REFERENCES `agent_tasks`(`id`) ON DELETE CASCADE, `policy_version` text NOT NULL, `evaluator_version` text NOT NULL, `decision` text NOT NULL CHECK(`decision` IN ('PASS','REPAIRABLE','REPLAN_REQUIRED','HUMAN_REQUIRED')), `input_artifacts_json` text NOT NULL CHECK(json_valid(`input_artifacts_json`)), `violations_json` text NOT NULL CHECK(json_valid(`violations_json`)), `evidence_refs_json` text NOT NULL CHECK(json_valid(`evidence_refs_json`)), `created_at` text NOT NULL);
--> statement-breakpoint
CREATE TABLE `agent_obstacle_fingerprints` (`run_id` text NOT NULL REFERENCES `agent_runs`(`id`) ON DELETE CASCADE, `fingerprint` text NOT NULL, `evidence_revision` text NOT NULL, `repair_count` integer NOT NULL DEFAULT 0 CHECK(`repair_count` >= 0), `replan_count` integer NOT NULL DEFAULT 0 CHECK(`replan_count` >= 0), PRIMARY KEY(`run_id`,`fingerprint`,`evidence_revision`));
--> statement-breakpoint
CREATE TABLE `agent_escalations` (`id` text PRIMARY KEY NOT NULL, `run_id` text NOT NULL REFERENCES `agent_runs`(`id`) ON DELETE CASCADE, `version` integer NOT NULL CHECK(`version` > 0), `state` text NOT NULL CHECK(`state` IN ('OPEN','RESOLVED','SUPERSEDED')), `obstacle_fingerprint` text NOT NULL, `safe_summary` text NOT NULL, `impact` text NOT NULL, `attempts_json` text NOT NULL CHECK(json_valid(`attempts_json`)), `budgets_json` text NOT NULL CHECK(json_valid(`budgets_json`)), `evidence_refs_json` text NOT NULL CHECK(json_valid(`evidence_refs_json`)), `reusable_artifacts_json` text NOT NULL CHECK(json_valid(`reusable_artifacts_json`)), UNIQUE(`run_id`,`version`));
--> statement-breakpoint
CREATE TABLE `agent_escalation_actions` (`escalation_id` text NOT NULL REFERENCES `agent_escalations`(`id`) ON DELETE CASCADE, `action_key` text NOT NULL, `schema_version` text NOT NULL, `schema_json` text NOT NULL CHECK(json_valid(`schema_json`)), `changes_immutable_inputs` integer NOT NULL CHECK(`changes_immutable_inputs` IN (0,1)), PRIMARY KEY(`escalation_id`,`action_key`,`schema_version`));
--> statement-breakpoint
CREATE TABLE `agent_outbox` (`id` text PRIMARY KEY NOT NULL, `run_id` text NOT NULL REFERENCES `agent_runs`(`id`) ON DELETE CASCADE, `operation_identity` text NOT NULL UNIQUE, `side_effect_class` text NOT NULL CHECK(`side_effect_class` IN ('idempotent-write','reversible-write','irreversible-write')), `state` text NOT NULL CHECK(`state` IN ('PENDING','SENDING','SENT','FAILED','UNKNOWN_OUTCOME')), `payload_ref` text, `attempts` integer NOT NULL DEFAULT 0 CHECK(`attempts` >= 0), `unknown_outcome` integer NOT NULL DEFAULT 0 CHECK(`unknown_outcome` IN (0,1)), `created_at` text NOT NULL);
--> statement-breakpoint
CREATE INDEX `agent_outbox_dispatch_idx` ON `agent_outbox` (`state`,`created_at`);
--> statement-breakpoint
CREATE TABLE `agent_compensations` (`id` text PRIMARY KEY NOT NULL, `outbox_id` text NOT NULL REFERENCES `agent_outbox`(`id`) ON DELETE CASCADE, `operation_identity` text NOT NULL UNIQUE, `state` text NOT NULL CHECK(`state` IN ('PENDING','SUCCEEDED','FAILED')), `outcome_json` text CHECK(`outcome_json` IS NULL OR json_valid(`outcome_json`)), `created_at` text NOT NULL);
