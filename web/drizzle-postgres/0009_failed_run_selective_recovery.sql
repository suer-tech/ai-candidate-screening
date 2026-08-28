ALTER TABLE agent_runs ADD COLUMN recovery_source_run_id text;
--> statement-breakpoint
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_recovery_source_fk
  FOREIGN KEY (recovery_source_run_id) REFERENCES agent_runs(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX agent_runs_recovery_source_idx ON agent_runs(recovery_source_run_id);
--> statement-breakpoint

ALTER TABLE agent_tasks ADD COLUMN reused_from_task_id text;
--> statement-breakpoint
ALTER TABLE agent_tasks ADD CONSTRAINT agent_tasks_reused_from_fk
  FOREIGN KEY (reused_from_task_id) REFERENCES agent_tasks(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX agent_tasks_reused_from_idx ON agent_tasks(reused_from_task_id);
