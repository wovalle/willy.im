CREATE TABLE `user_api_key` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`scopes` text DEFAULT '[]',
	`last_used_at` integer,
	`expires_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_api_key_key_hash_unique` ON `user_api_key` (`key_hash`);--> statement-breakpoint
CREATE INDEX `user_api_key_app_idx` ON `user_api_key` (`application_id`);--> statement-breakpoint
CREATE INDEX `user_api_key_app_user_idx` ON `user_api_key` (`application_id`,`user_id`);