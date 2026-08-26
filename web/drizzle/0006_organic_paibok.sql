CREATE TABLE `google_drive_oauth_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text,
	`principal_id` text NOT NULL,
	`event_type` text NOT NULL,
	`safe_code` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `google_drive_oauth_audit_connection_idx` ON `google_drive_oauth_audit_events` (`connection_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `google_drive_oauth_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`singleton_key` text DEFAULT 'primary' NOT NULL,
	`state` text NOT NULL,
	`owner_subject` text NOT NULL,
	`owner_email` text NOT NULL,
	`scopes_json` text NOT NULL,
	`root_folder_id` text NOT NULL,
	`root_folder_name` text DEFAULT 'Найм' NOT NULL,
	`deployment_mode` text NOT NULL,
	`token_ciphertext` text,
	`token_nonce` text,
	`token_tag` text,
	`token_key_version` text,
	`connected_at` text NOT NULL,
	`last_refresh_at` text,
	`reauth_required_at` text,
	`disconnected_at` text,
	`revision` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "google_drive_oauth_connection_revision_positive" CHECK("google_drive_oauth_connections"."revision" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_drive_oauth_connection_singleton_unique` ON `google_drive_oauth_connections` (`singleton_key`);--> statement-breakpoint
CREATE INDEX `google_drive_oauth_connection_state_idx` ON `google_drive_oauth_connections` (`state`);--> statement-breakpoint
CREATE TABLE `google_drive_oauth_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`state_hash` text NOT NULL,
	`principal_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`return_path` text NOT NULL,
	`verifier_ciphertext` text NOT NULL,
	`verifier_nonce` text NOT NULL,
	`verifier_tag` text NOT NULL,
	`verifier_key_version` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_drive_oauth_operation_state_unique` ON `google_drive_oauth_operations` (`state_hash`);--> statement-breakpoint
CREATE INDEX `google_drive_oauth_operation_expiry_idx` ON `google_drive_oauth_operations` (`expires_at`,`consumed_at`);--> statement-breakpoint
CREATE TABLE `google_drive_registered_objects` (
	`connection_id` text NOT NULL,
	`file_id` text NOT NULL,
	`parent_id` text,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`operation_identity` text,
	`checksum` text,
	`discovered_at` text NOT NULL,
	PRIMARY KEY(`connection_id`, `file_id`),
	FOREIGN KEY (`connection_id`) REFERENCES `google_drive_oauth_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `google_drive_registered_parent_idx` ON `google_drive_registered_objects` (`connection_id`,`parent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `google_drive_registered_operation_unique` ON `google_drive_registered_objects` (`connection_id`,`operation_identity`);