CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workspaces_updated_at` ON `workspaces` (`updated_at`);