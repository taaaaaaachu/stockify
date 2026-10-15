CREATE TABLE `passkeys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`public_key` blob NOT NULL,
	`counter` integer NOT NULL,
	`transports` text,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `passkeys_user_idx` ON `passkeys` (`user_id`);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text,
	`instance_role` text DEFAULT 'user' NOT NULL,
	`created_at` integer NOT NULL,
	`notify_minute_of_day` integer DEFAULT 540 NOT NULL,
	`must_change_password` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "username", "password_hash", "instance_role", "created_at", "notify_minute_of_day", "must_change_password") SELECT "id", "username", "password_hash", "instance_role", "created_at", "notify_minute_of_day", "must_change_password" FROM `users`;
--> statement-breakpoint
DROP TABLE `users`;
--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);
--> statement-breakpoint
ALTER TABLE `sessions` ADD `verified_at` integer;
