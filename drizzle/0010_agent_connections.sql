CREATE TABLE `agent_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`membership_id` text NOT NULL,
	`name` text NOT NULL,
	`client_id` text,
	`access_hash` text NOT NULL,
	`access_expires_at` integer,
	`refresh_hash` text,
	`previous_refresh_hash` text,
	`created_at` integer NOT NULL,
	`last_used_at` integer NOT NULL,
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_connections_access_hash_unique` ON `agent_connections` (`access_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_connections_refresh_hash_unique` ON `agent_connections` (`refresh_hash`);--> statement-breakpoint
CREATE INDEX `agent_connections_membership_idx` ON `agent_connections` (`membership_id`);