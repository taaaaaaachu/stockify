CREATE TABLE `auth_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`failed_count` integer NOT NULL,
	`window_started_at` integer NOT NULL,
	`blocked_until` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_attempts_scope_updated_idx` ON `auth_attempts` (`scope`, `updated_at`);
