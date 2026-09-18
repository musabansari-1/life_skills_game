CREATE TABLE `ai_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`task` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`latency_ms` integer NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`ok` integer NOT NULL,
	`error` text,
	`problems` text,
	`attempt_id` text,
	`player_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_calls_attempt_idx` ON `ai_calls` (`attempt_id`);--> statement-breakpoint
CREATE TABLE `dialogue_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`idx` integer NOT NULL,
	`speaker` text NOT NULL,
	`text` text NOT NULL,
	`modality` text NOT NULL,
	`moves` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `quest_attempts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dialogue_turns_attempt_idx` ON `dialogue_turns` (`attempt_id`,`idx`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_player_idx` ON `events` (`player_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `npc_states` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`npc_id` text NOT NULL,
	`relationship` text NOT NULL,
	`memory` text NOT NULL,
	`times_met` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `npc_states_player_npc_idx` ON `npc_states` (`player_id`,`npc_id`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`display_name` text NOT NULL,
	`onboarding_completed_at` text,
	`competencies` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `players_user_idx` ON `players` (`user_id`);--> statement-breakpoint
CREATE TABLE `quest_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`quest_id` text NOT NULL,
	`npc_id` text NOT NULL,
	`status` text NOT NULL,
	`hidden` text NOT NULL,
	`scene` text NOT NULL,
	`evaluation` text,
	`result` text,
	`snapshot_before` text NOT NULL,
	`modality` text DEFAULT 'text' NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `quest_attempts_player_idx` ON `quest_attempts` (`player_id`,`quest_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `world_states` (
	`player_id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
