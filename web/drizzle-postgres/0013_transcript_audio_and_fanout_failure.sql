ALTER TABLE artifact_blobs
  DROP CONSTRAINT artifact_blobs_size_global;
--> statement-breakpoint
ALTER TABLE artifact_blobs
  ADD CONSTRAINT artifact_blobs_size_global
  CHECK (byte_size > 0 AND byte_size <= 268435456);
--> statement-breakpoint
WITH recoverable_groups AS MATERIALIZED (
  SELECT fanout.id
  FROM agent_fanout_groups fanout
  JOIN agent_runs run ON run.id=fanout.run_id AND run.state='ACTIVE'
  WHERE fanout.state='FAILED'
    AND EXISTS (
      SELECT 1 FROM agent_fanout_members member
      JOIN agent_tasks task ON task.id=member.shard_task_id
      WHERE member.group_id=fanout.id AND member.required AND task.state='FAILED'
        AND task.tool_key='candidate.transcript-media-shard/v1'
        AND EXISTS (SELECT 1 FROM agent_attempts attempt WHERE attempt.task_id=task.id AND attempt.state='FAILED' AND attempt.error_code='BLOB_SIZE_LIMIT_EXCEEDED')
    )
    AND NOT EXISTS (
      SELECT 1 FROM agent_fanout_members member
      JOIN agent_tasks task ON task.id=member.shard_task_id
      WHERE member.group_id=fanout.id AND member.required AND task.state IN ('FAILED','CANCELLED','UNKNOWN_OUTCOME')
        AND NOT (task.tool_key='candidate.transcript-media-shard/v1'
          AND EXISTS (SELECT 1 FROM agent_attempts attempt WHERE attempt.task_id=task.id AND attempt.state='FAILED' AND attempt.error_code='BLOB_SIZE_LIMIT_EXCEEDED'))
    )
), reset_groups AS (
  UPDATE agent_fanout_groups fanout SET state='RUNNING'
  FROM recoverable_groups recoverable WHERE fanout.id=recoverable.id
), reset_tasks AS (
  UPDATE agent_tasks task SET state='RUNNABLE',revision=task.revision+1,available_at=0,lease_owner=NULL,lease_expires_at=NULL
  FROM agent_fanout_members member JOIN recoverable_groups recoverable ON recoverable.id=member.group_id
  WHERE task.id=member.shard_task_id AND task.state='FAILED' AND task.tool_key='candidate.transcript-media-shard/v1'
    AND EXISTS (SELECT 1 FROM agent_attempts attempt WHERE attempt.task_id=task.id AND attempt.state='FAILED' AND attempt.error_code='BLOB_SIZE_LIMIT_EXCEEDED')
  RETURNING task.id,task.run_id,task.revision,task.routing_class
)
INSERT INTO agent_task_dispatch_outbox
  (id,task_id,run_id,task_version,dispatch_generation,routing_class,state,available_at,created_at)
SELECT task.id || ':dispatch:' || task.revision,task.id,task.run_id,task.revision,task.revision,task.routing_class,'PENDING',0,
  to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM reset_tasks task
ON CONFLICT (task_id,task_version,dispatch_generation) DO NOTHING;
