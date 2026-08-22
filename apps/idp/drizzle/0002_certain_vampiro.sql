CREATE TABLE `linked_identity` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`label` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `linked_identity_provider_external_uidx` ON `linked_identity` (`provider`,`external_id`);--> statement-breakpoint
CREATE INDEX `linked_identity_user_idx` ON `linked_identity` (`user_id`);