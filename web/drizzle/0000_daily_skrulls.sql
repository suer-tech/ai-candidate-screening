CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` integer NOT NULL,
	`action` text NOT NULL,
	`actor` text NOT NULL,
	`timestamp` text NOT NULL,
	`outcome` text NOT NULL,
	`details` text
);
--> statement-breakpoint
CREATE TABLE `candidate_tombstones` (
	`candidate_id` integer PRIMARY KEY NOT NULL,
	`deleted_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `candidates` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`record_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `result_documents` (
	`candidate_id` integer NOT NULL,
	`type` text NOT NULL,
	`version` integer NOT NULL,
	`descriptor_json` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `result_documents_identity_unique` ON `result_documents` (`candidate_id`,`type`,`version`);--> statement-breakpoint
CREATE TABLE `vacancies` (
	`id` text PRIMARY KEY NOT NULL,
	`normalized_title` text NOT NULL,
	`record_json` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vacancies_normalized_title_unique` ON `vacancies` (`normalized_title`);--> statement-breakpoint
CREATE TABLE `vacancy_operations` (
	`operation_id` text PRIMARY KEY NOT NULL,
	`vacancy_id` text NOT NULL,
	`normalized_title` text NOT NULL,
	`input_json` text NOT NULL,
	`state` text NOT NULL,
	`folder_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vacancy_operations_normalized_title_unique` ON `vacancy_operations` (`normalized_title`);