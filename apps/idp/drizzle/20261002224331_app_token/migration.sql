CREATE TABLE `app_token` (
	`id` text PRIMARY KEY,
	`application_id` text NOT NULL,
	`prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`scopes` text NOT NULL,
	`workspace_id` text,
	`issued_by_key_id` text,
	`issued_by_user_id` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	CONSTRAINT `fk_app_token_issued_by_key_id_api_key_id_fk` FOREIGN KEY (`issued_by_key_id`) REFERENCES `api_key`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_app_token_issued_by_user_id_user_id_fk` FOREIGN KEY (`issued_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_token_key_hash_unique` ON `app_token` (`key_hash`);