CREATE TABLE `adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`at` integer NOT NULL,
	`remaining` real NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `stock_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `adjustments_item_idx` ON `adjustments` (`item_id`);--> statement-breakpoint
CREATE TABLE `households` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`default_lead_time_days` real DEFAULT 7 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`household_id` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`used_by` text,
	`used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`used_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_code_unique` ON `invites` (`code`);--> statement-breakpoint
CREATE INDEX `invites_household_idx` ON `invites` (`household_id`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`household_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memberships_user_idx` ON `memberships` (`user_id`);--> statement-breakpoint
CREATE INDEX `memberships_household_idx` ON `memberships` (`household_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_user_household_uq` ON `memberships` (`user_id`,`household_id`);--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`volume` real NOT NULL,
	`price` real,
	`purchased_at` integer NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `stock_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `purchases_item_idx` ON `purchases` (`item_id`);--> statement-breakpoint
CREATE TABLE `ranouts` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `stock_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ranouts_item_idx` ON `ranouts` (`item_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `stock_items` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`unit` text NOT NULL,
	`category` text,
	`lead_time_days` real,
	`provisional_days_to_deplete` real,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `stock_items_household_idx` ON `stock_items` (`household_id`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`interval_days` real NOT NULL,
	`next_delivery_at` integer NOT NULL,
	`volume_per_delivery` real NOT NULL,
	`quantity_per_delivery` real DEFAULT 1 NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `stock_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `subscriptions_item_idx` ON `subscriptions` (`item_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`instance_role` text DEFAULT 'user' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);