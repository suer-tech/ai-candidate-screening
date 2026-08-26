CREATE TABLE "auth_users" (
  "id" text PRIMARY KEY NOT NULL,
  "canonical_email" text NOT NULL,
  "display_name" text NOT NULL,
  "role" text DEFAULT 'HR-владелец вакансии' NOT NULL,
  "password_hash" text NOT NULL,
  "state" text DEFAULT 'ACTIVE' NOT NULL,
  "must_change_password" boolean DEFAULT true NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "auth_users_role_check" CHECK ("role" = 'HR-владелец вакансии'),
  CONSTRAINT "auth_users_state_check" CHECK ("state" IN ('ACTIVE','DISABLED')),
  CONSTRAINT "auth_users_email_canonical_check" CHECK ("canonical_email" = lower(btrim("canonical_email")))
);--> statement-breakpoint
CREATE UNIQUE INDEX "auth_users_canonical_email_unique" ON "auth_users" ("canonical_email");--> statement-breakpoint
CREATE INDEX "auth_users_state_idx" ON "auth_users" ("state");--> statement-breakpoint
CREATE TABLE "auth_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "auth_users"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "csrf_hash" text NOT NULL,
  "scope" text NOT NULL,
  "created_at" text NOT NULL,
  "expires_at" text NOT NULL,
  "revoked_at" text,
  "revoke_reason" text,
  CONSTRAINT "auth_sessions_scope_check" CHECK ("scope" IN ('FULL','PASSWORD_CHANGE_ONLY'))
);--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_hash_unique" ON "auth_sessions" ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_expiry_idx" ON "auth_sessions" ("user_id","expires_at");--> statement-breakpoint
CREATE TABLE "auth_login_attempts" (
  "id" text PRIMARY KEY NOT NULL,
  "email_fingerprint" text NOT NULL,
  "source_fingerprint" text NOT NULL,
  "attempted_at" text NOT NULL,
  "blocked_until" text
);--> statement-breakpoint
CREATE INDEX "auth_login_attempt_pair_idx" ON "auth_login_attempts" ("email_fingerprint","source_fingerprint","attempted_at");--> statement-breakpoint
CREATE TABLE "auth_security_events" (
  "id" text PRIMARY KEY NOT NULL,
  "event_type" text NOT NULL,
  "actor_id" text,
  "target_id" text,
  "safe_code" text NOT NULL,
  "occurred_at" text NOT NULL
);--> statement-breakpoint
CREATE INDEX "auth_security_event_time_idx" ON "auth_security_events" ("occurred_at");--> statement-breakpoint
CREATE INDEX "auth_security_event_target_idx" ON "auth_security_events" ("target_id","occurred_at");
