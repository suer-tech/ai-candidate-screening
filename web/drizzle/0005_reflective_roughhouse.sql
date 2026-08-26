ALTER TABLE `candidates` ADD `public_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `candidates_public_id_unique` ON `candidates` (`public_id`);