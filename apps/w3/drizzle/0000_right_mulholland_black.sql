CREATE TABLE `kv` (
	`id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer
);
