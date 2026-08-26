CREATE TABLE `candidate_drive_folder_tombstones` (
	`drive_folder_id` text PRIMARY KEY NOT NULL,
	`deleted_at_utc` text NOT NULL,
	`cleanup_evidence_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `candidate_drive_folders` (
	`drive_folder_id` text PRIMARY KEY NOT NULL,
	`candidate_id` integer NOT NULL,
	`vacancy_folder_id` text NOT NULL,
	`display_name` text NOT NULL,
	`parent_path` text NOT NULL,
	`first_seen_at_utc` text NOT NULL,
	`last_seen_at_utc` text NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_drive_folders_candidate_unique` ON `candidate_drive_folders` (`candidate_id`);--> statement-breakpoint
CREATE INDEX `candidate_drive_folders_vacancy_idx` ON `candidate_drive_folders` (`vacancy_folder_id`);