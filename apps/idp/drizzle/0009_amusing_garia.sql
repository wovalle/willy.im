ALTER TABLE `application_invitation` ADD `product_permissions` text DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `application_member` ADD `product_permissions` text DEFAULT '[]';