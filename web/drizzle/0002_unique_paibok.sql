CREATE TABLE `vacancy_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`event_type` text NOT NULL,
	`attempt_number` integer,
	`safe_code` text,
	`actor` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vacancy_audit_operation_idx` ON `vacancy_audit_events` (`operation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `vacancy_generation_attempts` (
	`operation_id` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`outcome` text NOT NULL,
	`safe_code` text,
	`trace_id` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`operation_id`, `attempt_number`, `outcome`),
	FOREIGN KEY (`operation_id`) REFERENCES `vacancy_generation_operations`(`operation_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "vacancy_generation_attempt_number" CHECK("vacancy_generation_attempts"."attempt_number" > 0 AND "vacancy_generation_attempts"."attempt_number" <= 4)
);
--> statement-breakpoint
CREATE TABLE `vacancy_generation_operations` (
	`operation_id` text PRIMARY KEY NOT NULL,
	`original_title` text NOT NULL,
	`normalized_title` text NOT NULL,
	`state` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`generated_profile_json` text,
	`snapshot_hash` text,
	`error_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "vacancy_generation_attempt_count" CHECK("vacancy_generation_operations"."attempt_count" >= 0 AND "vacancy_generation_operations"."attempt_count" <= 4)
);
--> statement-breakpoint
CREATE INDEX `vacancy_generation_title_idx` ON `vacancy_generation_operations` (`normalized_title`,`state`);