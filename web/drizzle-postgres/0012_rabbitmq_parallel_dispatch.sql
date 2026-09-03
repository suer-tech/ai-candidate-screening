ALTER TABLE agent_tasks
  ADD COLUMN routing_class text NOT NULL DEFAULT 'control',
  ADD COLUMN available_at bigint NOT NULL DEFAULT 0,
  ADD COLUMN output_artifact_id text,
  ADD COLUMN fanout_group_id text,
  ADD COLUMN shard_identity text,
  ADD COLUMN shard_payload_json text NOT NULL DEFAULT '{}';
--> statement-breakpoint
CREATE TABLE agent_task_dispatch_outbox (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
  run_id text NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  task_version integer NOT NULL,
  dispatch_generation integer NOT NULL,
  routing_class text NOT NULL,
  state text NOT NULL DEFAULT 'PENDING',
  available_at bigint NOT NULL DEFAULT 0,
  publish_attempts integer NOT NULL DEFAULT 0,
  publish_owner text,
  publish_lease_until bigint,
  broker_message_id text,
  last_error_code text,
  created_at text NOT NULL,
  published_at text,
  confirmed_at text,
  CONSTRAINT agent_dispatch_state_valid CHECK (state IN ('PENDING','PUBLISHING','PUBLISHED','FAILED')),
  CONSTRAINT agent_dispatch_generation_positive CHECK (dispatch_generation > 0),
  CONSTRAINT agent_dispatch_attempts_nonnegative CHECK (publish_attempts >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX agent_task_dispatch_generation_unique
  ON agent_task_dispatch_outbox(task_id, task_version, dispatch_generation);
--> statement-breakpoint
CREATE INDEX agent_task_dispatch_pending_idx
  ON agent_task_dispatch_outbox(state, available_at, created_at);
--> statement-breakpoint
CREATE TABLE agent_fanout_groups (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  plan_version_id text NOT NULL REFERENCES agent_plan_versions(id) ON DELETE CASCADE,
  group_key text NOT NULL,
  kind text NOT NULL,
  descriptor_json text NOT NULL,
  descriptor_fingerprint text NOT NULL,
  expected_count integer NOT NULL,
  join_task_id text REFERENCES agent_tasks(id) ON DELETE SET NULL,
  state text NOT NULL DEFAULT 'PLANNED',
  created_at text NOT NULL,
  completed_at text,
  CONSTRAINT agent_fanout_expected_nonnegative CHECK (expected_count >= 0),
  CONSTRAINT agent_fanout_state_valid CHECK (state IN ('PLANNED','RUNNING','SUCCEEDED','FAILED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX agent_fanout_group_key_unique
  ON agent_fanout_groups(run_id, plan_version_id, group_key);
--> statement-breakpoint
CREATE UNIQUE INDEX agent_fanout_descriptor_unique
  ON agent_fanout_groups(run_id, descriptor_fingerprint);
--> statement-breakpoint
CREATE TABLE agent_fanout_members (
  group_id text NOT NULL REFERENCES agent_fanout_groups(id) ON DELETE CASCADE,
  shard_task_id text NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
  shard_identity text NOT NULL,
  ordinal integer NOT NULL,
  required boolean NOT NULL DEFAULT true,
  PRIMARY KEY(group_id, shard_task_id),
  CONSTRAINT agent_fanout_ordinal_nonnegative CHECK (ordinal >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX agent_fanout_member_identity_unique
  ON agent_fanout_members(group_id, shard_identity);
--> statement-breakpoint
CREATE UNIQUE INDEX agent_fanout_member_ordinal_unique
  ON agent_fanout_members(group_id, ordinal);
--> statement-breakpoint
CREATE INDEX agent_tasks_fair_runnable_idx
  ON agent_tasks(routing_class, state, available_at, run_id, id);
