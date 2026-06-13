CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`table_name` text NOT NULL,
	`operation` text NOT NULL,
	`row_id` text,
	`application_id` text,
	`user_id` text,
	`actor` text,
	`old_data` text,
	`new_data` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_logs_application_id_idx` ON `audit_logs` (`application_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_table_name_idx` ON `audit_logs` (`table_name`);--> statement-breakpoint
CREATE INDEX `audit_logs_created_at_idx` ON `audit_logs` (`created_at`);