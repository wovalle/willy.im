ALTER TABLE `api_key` ADD `minted_by_human` integer DEFAULT false NOT NULL;
--> statement-breakpoint
-- Every existing key with a creator was minted by that human.
UPDATE `api_key` SET `minted_by_human` = 1 WHERE `created_by_user_id` IS NOT NULL;
