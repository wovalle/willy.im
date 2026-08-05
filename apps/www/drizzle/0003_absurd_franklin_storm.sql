CREATE TABLE `logs` (
	`id` text PRIMARY KEY NOT NULL,
	`filename` text,
	`client` text,
	`content_type` text,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL
);
