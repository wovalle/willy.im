PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_api_key` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`permissions` text DEFAULT '[]',
	`created_by_user_id` text,
	`last_used_at` integer,
	`expires_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_api_key`("id", "application_id", "name", "prefix", "key_hash", "permissions", "created_by_user_id", "last_used_at", "expires_at", "revoked_at", "created_at") SELECT "id", "application_id", "name", "prefix", "key_hash", "permissions", "created_by_user_id", "last_used_at", "expires_at", "revoked_at", "created_at" FROM `api_key`;--> statement-breakpoint
DROP TABLE `api_key`;--> statement-breakpoint
ALTER TABLE `__new_api_key` RENAME TO `api_key`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `api_key_key_hash_unique` ON `api_key` (`key_hash`);--> statement-breakpoint
CREATE INDEX `api_key_app_idx` ON `api_key` (`application_id`);