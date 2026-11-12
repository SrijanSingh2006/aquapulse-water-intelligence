CREATE TABLE `audit_events` (
	`workspace_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`event_json` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `sequence`)
);
--> statement-breakpoint
CREATE TABLE `request_receipts` (
	`workspace_id` text NOT NULL,
	`key` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_json` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `key`)
);
--> statement-breakpoint
ALTER TABLE `workspaces` ADD `last_write_id` text DEFAULT '' NOT NULL;