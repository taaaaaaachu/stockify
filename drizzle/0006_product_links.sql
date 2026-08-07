CREATE TABLE `product_links` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`url` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `stock_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `product_links_item_idx` ON `product_links` (`item_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_links_item_url_uq` ON `product_links` (`item_id`,`url`);
