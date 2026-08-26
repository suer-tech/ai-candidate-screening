CREATE TABLE private_benchmark_guards (
  run_id text PRIMARY KEY,
  deny_checksums_json text NOT NULL,
  created_at_utc text NOT NULL,
  CONSTRAINT private_benchmark_guards_json CHECK (jsonb_typeof(deny_checksums_json::jsonb) = 'array')
);
--> statement-breakpoint
CREATE TABLE private_benchmark_boundary_audits (
  run_id text NOT NULL,
  boundary text NOT NULL,
  payload_checksum text NOT NULL,
  created_at_utc text NOT NULL,
  PRIMARY KEY (run_id,boundary,payload_checksum),
  CONSTRAINT private_benchmark_boundary_allowed CHECK (boundary IN ('drive','provider','blob')),
  CONSTRAINT private_benchmark_boundary_checksum CHECK (payload_checksum ~ '^[0-9a-f]{64}$')
);
