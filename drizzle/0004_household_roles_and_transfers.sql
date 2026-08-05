CREATE TABLE `ownership_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL REFERENCES `households`(`id`) ON DELETE cascade,
	`current_owner_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
	`candidate_user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ownership_transfers_household_uq` ON `ownership_transfers` (`household_id`);
--> statement-breakpoint
CREATE INDEX `ownership_transfers_candidate_idx` ON `ownership_transfers` (`candidate_user_id`);
--> statement-breakpoint
UPDATE `memberships`
SET `role` = 'manager'
WHERE `role` = 'owner'
	AND `id` NOT IN (
		SELECT `oldest`.`id`
		FROM `memberships` AS `oldest`
		WHERE `oldest`.`role` = 'owner'
			AND `oldest`.`household_id` = `memberships`.`household_id`
		ORDER BY `oldest`.`created_at`, `oldest`.`id`
		LIMIT 1
	);
--> statement-breakpoint
UPDATE `memberships`
SET `role` = 'owner'
WHERE `id` IN (
	SELECT `oldest_member`.`id`
	FROM `memberships` AS `oldest_member`
	WHERE `oldest_member`.`role` = 'member'
		AND NOT EXISTS (
			SELECT 1 FROM `memberships` AS `existing_owner`
			WHERE `existing_owner`.`household_id` = `oldest_member`.`household_id`
				AND `existing_owner`.`role` = 'owner'
		)
		AND `oldest_member`.`id` = (
			SELECT `candidate`.`id`
			FROM `memberships` AS `candidate`
			WHERE `candidate`.`household_id` = `oldest_member`.`household_id`
			ORDER BY `candidate`.`created_at`, `candidate`.`id`
			LIMIT 1
		)
);
