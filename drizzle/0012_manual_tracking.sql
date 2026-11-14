CREATE TABLE `usages` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`at` integer NOT NULL,
	`volume` real NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `stock_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `usages_item_idx` ON `usages` (`item_id`);--> statement-breakpoint
ALTER TABLE `stock_items` ADD `tracking_mode` text DEFAULT 'estimated' NOT NULL;--> statement-breakpoint
ALTER TABLE `stock_items` ADD `low_stock_threshold` real;