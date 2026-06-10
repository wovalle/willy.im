CREATE TABLE `application_invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`permissions` text DEFAULT '[]',
	`token` text NOT NULL,
	`invited_by_user_id` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`invited_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_invitation_token_unique` ON `application_invitation` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `application_invitation_app_email_uidx` ON `application_invitation` (`application_id`,`email`);