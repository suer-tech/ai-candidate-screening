import { sql } from "drizzle-orm";
import { bigint, boolean, check, customType, index, integer, primaryKey, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
});

export const vacancies = pgTable("vacancies", {
  id: text("id").primaryKey(),
  normalizedTitle: text("normalized_title").notNull(),
  recordJson: text("record_json").notNull(),
}, (table) => [uniqueIndex("vacancies_normalized_title_unique").on(table.normalizedTitle)]);

export const vacancyOperations = pgTable("vacancy_operations", {
  operationId: text("operation_id").primaryKey(),
  vacancyId: text("vacancy_id").notNull(),
  normalizedTitle: text("normalized_title").notNull(),
  inputJson: text("input_json").notNull(),
  state: text("state", { enum: ["provisioning", "committed"] }).notNull(),
  folderId: text("folder_id"),
}, (table) => [uniqueIndex("vacancy_operations_normalized_title_unique").on(table.normalizedTitle)]);

export const vacancyGenerationOperations = pgTable("vacancy_generation_operations", {
  operationId: text("operation_id").primaryKey(),
  originalTitle: text("original_title").notNull(),
  normalizedTitle: text("normalized_title").notNull(),
  state: text("state", { enum: ["PENDING", "SUCCEEDED", "FAILED"] }).notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  generatedProfileJson: text("generated_profile_json"),
  snapshotHash: text("snapshot_hash"),
  errorCode: text("error_code"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("vacancy_generation_title_idx").on(table.normalizedTitle, table.state),
  check("vacancy_generation_attempt_count", sql`${table.attemptCount} >= 0 AND ${table.attemptCount} <= 4`),
]);

export const vacancyGenerationAttempts = pgTable("vacancy_generation_attempts", {
  operationId: text("operation_id").notNull().references(() => vacancyGenerationOperations.operationId, { onDelete: "cascade" }),
  attemptNumber: integer("attempt_number").notNull(),
  outcome: text("outcome").notNull(),
  safeCode: text("safe_code"),
  traceId: text("trace_id"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.operationId, table.attemptNumber, table.outcome] }),
  check("vacancy_generation_attempt_number", sql`${table.attemptNumber} > 0 AND ${table.attemptNumber} <= 4`),
]);

export const vacancyAuditEvents = pgTable("vacancy_audit_events", {
  id: text("id").primaryKey(),
  operationId: text("operation_id").notNull(),
  eventType: text("event_type").notNull(),
  attemptNumber: integer("attempt_number"),
  safeCode: text("safe_code"),
  actor: text("actor").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("vacancy_audit_operation_idx").on(table.operationId, table.createdAt)]);

export const candidates = pgTable("candidates", {
  id: integer("id").primaryKey(),
  publicId: text("public_id"),
  revision: integer("revision").notNull(),
  recordJson: text("record_json").notNull(),
}, (table) => [uniqueIndex("candidates_public_id_unique").on(table.publicId)]);

export const resultDocuments = pgTable("result_documents", {
  candidateId: integer("candidate_id").notNull(),
  type: text("type", { enum: ["candidate-results", "abc-test"] }).notNull(),
  version: integer("version").notNull(),
  descriptorJson: text("descriptor_json").notNull(),
}, (table) => [uniqueIndex("result_documents_identity_unique").on(table.candidateId, table.type, table.version)]);

export const auditEvents = pgTable("audit_events", {
  id: text("id").primaryKey(),
  candidateId: integer("candidate_id").notNull(),
  action: text("action").notNull(),
  actor: text("actor").notNull(),
  timestamp: text("timestamp").notNull(),
  outcome: text("outcome").notNull(),
  details: text("details"),
});

export const candidateTombstones = pgTable("candidate_tombstones", {
  candidateId: integer("candidate_id").primaryKey(),
  deletedAt: text("deleted_at").notNull(),
});

export const candidateDriveFolders = pgTable("candidate_drive_folders", {
  driveFolderId: text("drive_folder_id").primaryKey(),
  candidateId: integer("candidate_id").notNull().references(() => candidates.id, { onDelete: "cascade" }),
  vacancyFolderId: text("vacancy_folder_id").notNull(),
  displayName: text("display_name").notNull(),
  parentPath: text("parent_path").notNull(),
  firstSeenAtUtc: text("first_seen_at_utc").notNull(),
  lastSeenAtUtc: text("last_seen_at_utc").notNull(),
}, (table) => [uniqueIndex("candidate_drive_folders_candidate_unique").on(table.candidateId), index("candidate_drive_folders_vacancy_idx").on(table.vacancyFolderId)]);

export const candidateDriveFolderTombstones = pgTable("candidate_drive_folder_tombstones", {
  driveFolderId: text("drive_folder_id").primaryKey(),
  deletedAtUtc: text("deleted_at_utc").notNull(),
  cleanupEvidenceJson: text("cleanup_evidence_json").notNull(),
});

export const googleDriveOAuthConnections = pgTable("google_drive_oauth_connections", {
  id: text("id").primaryKey(),
  singletonKey: text("singleton_key").notNull().default("primary"),
  state: text("state", { enum: ["CONNECTED", "REAUTH_REQUIRED", "DISCONNECTED", "MISCONFIGURED"] }).notNull(),
  ownerSubject: text("owner_subject").notNull(),
  ownerEmail: text("owner_email").notNull(),
  scopesJson: text("scopes_json").notNull(),
  rootFolderId: text("root_folder_id").notNull(),
  rootFolderName: text("root_folder_name").notNull().default("Найм"),
  deploymentMode: text("deployment_mode", { enum: ["testing", "production-personal"] }).notNull(),
  tokenCiphertext: text("token_ciphertext"),
  tokenNonce: text("token_nonce"),
  tokenTag: text("token_tag"),
  tokenKeyVersion: text("token_key_version"),
  connectedAt: text("connected_at").notNull(),
  lastRefreshAt: text("last_refresh_at"),
  reauthRequiredAt: text("reauth_required_at"),
  disconnectedAt: text("disconnected_at"),
  revision: integer("revision").notNull().default(1),
}, (table) => [
  uniqueIndex("google_drive_oauth_connection_singleton_unique").on(table.singletonKey),
  index("google_drive_oauth_connection_state_idx").on(table.state),
  check("google_drive_oauth_connection_revision_positive", sql`${table.revision} > 0`),
]);

export const googleDriveOAuthOperations = pgTable("google_drive_oauth_operations", {
  id: text("id").primaryKey(),
  stateHash: text("state_hash").notNull(),
  principalId: text("principal_id").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  returnPath: text("return_path").notNull(),
  verifierCiphertext: text("verifier_ciphertext").notNull(),
  verifierNonce: text("verifier_nonce").notNull(),
  verifierTag: text("verifier_tag").notNull(),
  verifierKeyVersion: text("verifier_key_version").notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  consumedAt: bigint("consumed_at", { mode: "number" }),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("google_drive_oauth_operation_state_unique").on(table.stateHash),
  index("google_drive_oauth_operation_expiry_idx").on(table.expiresAt, table.consumedAt),
]);

export const googleDriveRegisteredObjects = pgTable("google_drive_registered_objects", {
  connectionId: text("connection_id").notNull().references(() => googleDriveOAuthConnections.id, { onDelete: "cascade" }),
  fileId: text("file_id").notNull(),
  parentId: text("parent_id"),
  kind: text("kind", { enum: ["root", "folder", "file", "derived"] }).notNull(),
  name: text("name").notNull(),
  operationIdentity: text("operation_identity"),
  checksum: text("checksum"),
  discoveredAt: text("discovered_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.connectionId, table.fileId] }),
  index("google_drive_registered_parent_idx").on(table.connectionId, table.parentId),
  uniqueIndex("google_drive_registered_operation_unique").on(table.connectionId, table.operationIdentity),
]);

export const googleDriveOAuthAuditEvents = pgTable("google_drive_oauth_audit_events", {
  id: text("id").primaryKey(),
  connectionId: text("connection_id"),
  principalId: text("principal_id").notNull(),
  eventType: text("event_type").notNull(),
  safeCode: text("safe_code"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("google_drive_oauth_audit_connection_idx").on(table.connectionId, table.createdAt)]);

export const authUsers = pgTable("auth_users", {
  id: text("id").primaryKey(),
  canonicalEmail: text("canonical_email").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role", { enum: ["HR-владелец вакансии"] }).notNull().default("HR-владелец вакансии"),
  passwordHash: text("password_hash").notNull(),
  state: text("state", { enum: ["ACTIVE", "DISABLED"] }).notNull().default("ACTIVE"),
  mustChangePassword: boolean("must_change_password").notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("auth_users_canonical_email_unique").on(table.canonicalEmail), index("auth_users_state_idx").on(table.state)]);

export const authSessions = pgTable("auth_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  csrfHash: text("csrf_hash").notNull(),
  scope: text("scope", { enum: ["FULL", "PASSWORD_CHANGE_ONLY"] }).notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  revokedAt: text("revoked_at"),
  revokeReason: text("revoke_reason"),
}, (table) => [uniqueIndex("auth_sessions_token_hash_unique").on(table.tokenHash), index("auth_sessions_user_expiry_idx").on(table.userId, table.expiresAt)]);

export const authLoginAttempts = pgTable("auth_login_attempts", {
  id: text("id").primaryKey(),
  emailFingerprint: text("email_fingerprint").notNull(),
  sourceFingerprint: text("source_fingerprint").notNull(),
  attemptedAt: text("attempted_at").notNull(),
  blockedUntil: text("blocked_until"),
}, (table) => [index("auth_login_attempt_pair_idx").on(table.emailFingerprint, table.sourceFingerprint, table.attemptedAt)]);

export const authSecurityEvents = pgTable("auth_security_events", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  actorId: text("actor_id"),
  targetId: text("target_id"),
  safeCode: text("safe_code").notNull(),
  occurredAt: text("occurred_at").notNull(),
}, (table) => [index("auth_security_event_time_idx").on(table.occurredAt), index("auth_security_event_target_idx").on(table.targetId, table.occurredAt)]);

export const agentGoals = pgTable("agent_goals", {
  id: text("id").primaryKey(),
  candidateId: integer("candidate_id").notNull().references(() => candidates.id, { onDelete: "cascade" }),
  goalType: text("goal_type").notNull(),
  inputVersion: text("input_version").notNull(),
  profileVersion: text("profile_version").notNull(),
  policyVersion: text("policy_version").notNull(),
  completionCriteriaVersion: text("completion_criteria_version").notNull(),
  completionCriteriaJson: text("completion_criteria_json").notNull(),
  state: text("state").notNull(),
  revision: integer("revision").notNull().default(1),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("agent_goals_identity_unique").on(table.candidateId, table.inputVersion, table.profileVersion, table.goalType),
  index("agent_goals_candidate_idx").on(table.candidateId),
  check("agent_goals_revision_positive", sql`${table.revision} > 0`),
]);

export const agentRuns = pgTable("agent_runs", {
  id: text("id").primaryKey(),
  goalId: text("goal_id").notNull().references(() => agentGoals.id, { onDelete: "cascade" }),
  triggerIdentity: text("trigger_identity").notNull(),
  originEscalationId: text("origin_escalation_id"),
  state: text("state").notNull(),
  revision: integer("revision").notNull().default(1),
  currentPlanVersion: integer("current_plan_version").notNull().default(1),
  lastProgressAt: text("last_progress_at").notNull(),
}, (table) => [
  uniqueIndex("agent_runs_trigger_unique").on(table.triggerIdentity),
  index("agent_runs_goal_idx").on(table.goalId),
  check("agent_runs_revision_positive", sql`${table.revision} > 0`),
]);

export const agentPlanVersions = pgTable("agent_plan_versions", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  reason: text("reason").notNull(),
  obstacleFingerprint: text("obstacle_fingerprint"),
  mappingJson: text("mapping_json"),
  planJson: text("plan_json").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("agent_plan_versions_run_version_unique").on(table.runId, table.version),
  check("agent_plan_versions_version_positive", sql`${table.version} > 0`),
]);

export const agentTasks = pgTable("agent_tasks", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
  planVersionId: text("plan_version_id").notNull().references(() => agentPlanVersions.id, { onDelete: "cascade" }),
  taskKey: text("task_key").notNull(),
  toolKey: text("tool_key").notNull(),
  state: text("state").notNull(),
  revision: integer("revision").notNull().default(1),
  attemptCount: integer("attempt_count").notNull().default(0),
  leaseOwner: text("lease_owner"),
  leaseToken: integer("lease_token").notNull().default(0),
  leaseExpiresAt: bigint("lease_expires_at", { mode: "number" }),
  idempotencyIdentity: text("idempotency_identity").notNull(),
  preconditionsJson: text("preconditions_json").notNull(),
  expectedOutputsJson: text("expected_outputs_json").notNull(),
}, (table) => [
  uniqueIndex("agent_tasks_plan_key_unique").on(table.planVersionId, table.taskKey),
  uniqueIndex("agent_tasks_operation_identity_unique").on(table.idempotencyIdentity),
  index("agent_tasks_runnable_claim_idx").on(table.state, table.leaseExpiresAt, table.runId),
  index("agent_tasks_stale_lease_idx").on(table.leaseExpiresAt, table.leaseToken),
]);

export const agentTaskDependencies = pgTable("agent_task_dependencies", {
  taskId: text("task_id").notNull().references(() => agentTasks.id, { onDelete: "cascade" }),
  dependsOnTaskId: text("depends_on_task_id").notNull().references(() => agentTasks.id, { onDelete: "cascade" }),
  requiredOutcome: text("required_outcome").notNull().default("SUCCEEDED"),
}, (table) => [primaryKey({ columns: [table.taskId, table.dependsOnTaskId] }), check("agent_task_dependency_not_self", sql`${table.taskId} <> ${table.dependsOnTaskId}`)]);

export const agentAttempts = pgTable("agent_attempts", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => agentTasks.id, { onDelete: "cascade" }),
  attemptNumber: integer("attempt_number").notNull(),
  leaseOwner: text("lease_owner").notNull(),
  leaseToken: integer("lease_token").notNull(),
  state: text("state").notNull(),
  unknownOutcome: boolean("unknown_outcome").notNull().default(false),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  errorCode: text("error_code"),
}, (table) => [uniqueIndex("agent_attempts_task_number_unique").on(table.taskId, table.attemptNumber), uniqueIndex("agent_attempts_fencing_unique").on(table.taskId, table.leaseToken)]);

export const agentEvents = pgTable("agent_events", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  eventIdentity: text("event_identity").notNull(),
  type: text("type").notNull(),
  actor: text("actor").notNull(),
  planVersion: integer("plan_version").notNull(),
  taskId: text("task_id").references(() => agentTasks.id, { onDelete: "set null" }),
  safePayloadJson: text("safe_payload_json").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("agent_events_run_sequence_unique").on(table.runId, table.sequence), uniqueIndex("agent_events_identity_unique").on(table.eventIdentity), index("agent_events_lookup_idx").on(table.runId, table.type, table.sequence)]);

export const agentCheckpoints = pgTable("agent_checkpoints", {
  id: text("id").primaryKey(),
  attemptId: text("attempt_id").notNull().references(() => agentAttempts.id, { onDelete: "cascade" }),
  leaseToken: integer("lease_token").notNull(),
  kind: text("kind").notNull(),
  identity: text("identity").notNull(),
  remoteJobId: text("remote_job_id"),
  artifactIdentity: text("artifact_identity"),
  checksum: text("checksum"),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("agent_checkpoints_attempt_identity_unique").on(table.attemptId, table.kind, table.identity)]);

export const agentMemoryEntries = pgTable("agent_memory_entries", {
  id: text("id").primaryKey(),
  goalId: text("goal_id").notNull().references(() => agentGoals.id, { onDelete: "cascade" }),
  runId: text("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
  candidateId: integer("candidate_id").notNull().references(() => candidates.id, { onDelete: "cascade" }),
  inputVersion: text("input_version").notNull(),
  profileVersion: text("profile_version").notNull(),
  kind: text("kind").notNull(),
  provenance: text("provenance").notNull(),
  sensitivity: text("sensitivity").notNull(),
  purpose: text("purpose").notNull(),
  payloadJson: text("payload_json"),
  supersededAt: text("superseded_at"),
  immutable: boolean("immutable").notNull(),
}, (table) => [index("agent_memory_scope_idx").on(table.candidateId, table.runId, table.inputVersion, table.purpose)]);

export const agentArtifactRefs = pgTable("agent_artifact_refs", {
  id: text("id").primaryKey(),
  memoryEntryId: text("memory_entry_id").notNull().references(() => agentMemoryEntries.id, { onDelete: "cascade" }),
  storageClass: text("storage_class").notNull(),
  storageIdentity: text("storage_identity").notNull(),
  checksum: text("checksum").notNull(),
  schemaVersion: text("schema_version").notNull(),
}, (table) => [uniqueIndex("agent_artifact_identity_unique").on(table.storageClass, table.storageIdentity, table.checksum)]);

export const agentToolGrants = pgTable("agent_tool_grants", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => agentTasks.id, { onDelete: "cascade" }),
  candidateId: integer("candidate_id").notNull().references(() => candidates.id, { onDelete: "cascade" }),
  runId: text("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
  inputVersion: text("input_version").notNull(),
  policyVersion: text("policy_version").notNull(),
  toolKey: text("tool_key").notNull(),
  operationsJson: text("operations_json").notNull(),
  sideEffectClass: text("side_effect_class").notNull(),
  budgetLink: text("budget_link").notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  revokedAt: bigint("revoked_at", { mode: "number" }),
}, (table) => [index("agent_tool_grants_scope_idx").on(table.taskId, table.runId, table.inputVersion, table.expiresAt)]);

export const agentBudgetLedger = pgTable("agent_budget_ledger", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  limitValue: integer("limit_value").notNull(),
  usedValue: integer("used_value").notNull().default(0),
  revision: integer("revision").notNull().default(1),
}, (table) => [uniqueIndex("agent_budget_ledger_run_kind_unique").on(table.runId, table.kind), check("agent_budget_nonnegative", sql`${table.limitValue} > 0 AND ${table.usedValue} >= 0 AND ${table.usedValue} <= ${table.limitValue}`)]);

export const agentBudgetReservations = pgTable("agent_budget_reservations", {
  id: text("id").primaryKey(),
  ledgerId: text("ledger_id").notNull().references(() => agentBudgetLedger.id, { onDelete: "cascade" }),
  operationIdentity: text("operation_identity").notNull(),
  amount: integer("amount").notNull(),
  state: text("state").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("agent_budget_reservation_operation_unique").on(table.ledgerId, table.operationIdentity), check("agent_budget_reservation_positive", sql`${table.amount} > 0`)]);

export const agentEvalResults = pgTable("agent_eval_results", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => agentTasks.id, { onDelete: "cascade" }),
  policyVersion: text("policy_version").notNull(),
  evaluatorVersion: text("evaluator_version").notNull(),
  decision: text("decision").notNull(),
  inputArtifactsJson: text("input_artifacts_json").notNull(),
  violationsJson: text("violations_json").notNull(),
  evidenceRefsJson: text("evidence_refs_json").notNull(),
  createdAt: text("created_at").notNull(),
});

export const agentObstacleFingerprints = pgTable("agent_obstacle_fingerprints", {
  runId: text("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
  fingerprint: text("fingerprint").notNull(),
  evidenceRevision: text("evidence_revision").notNull(),
  repairCount: integer("repair_count").notNull().default(0),
  replanCount: integer("replan_count").notNull().default(0),
}, (table) => [primaryKey({ columns: [table.runId, table.fingerprint, table.evidenceRevision] })]);

export const agentEscalations = pgTable("agent_escalations", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  state: text("state").notNull(),
  obstacleFingerprint: text("obstacle_fingerprint").notNull(),
  safeSummary: text("safe_summary").notNull(),
  impact: text("impact").notNull(),
  attemptsJson: text("attempts_json").notNull(),
  budgetsJson: text("budgets_json").notNull(),
  evidenceRefsJson: text("evidence_refs_json").notNull(),
  reusableArtifactsJson: text("reusable_artifacts_json").notNull(),
}, (table) => [uniqueIndex("agent_escalations_run_version_unique").on(table.runId, table.version)]);

export const agentEscalationActions = pgTable("agent_escalation_actions", {
  escalationId: text("escalation_id").notNull().references(() => agentEscalations.id, { onDelete: "cascade" }),
  actionKey: text("action_key").notNull(),
  schemaVersion: text("schema_version").notNull(),
  schemaJson: text("schema_json").notNull(),
  changesImmutableInputs: boolean("changes_immutable_inputs").notNull(),
}, (table) => [primaryKey({ columns: [table.escalationId, table.actionKey, table.schemaVersion] })]);

export const agentOutbox = pgTable("agent_outbox", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
  operationIdentity: text("operation_identity").notNull(),
  sideEffectClass: text("side_effect_class").notNull(),
  state: text("state").notNull(),
  payloadRef: text("payload_ref"),
  attempts: integer("attempts").notNull().default(0),
  unknownOutcome: boolean("unknown_outcome").notNull().default(false),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("agent_outbox_operation_unique").on(table.operationIdentity), index("agent_outbox_dispatch_idx").on(table.state, table.createdAt)]);

export const agentCompensations = pgTable("agent_compensations", {
  id: text("id").primaryKey(),
  outboxId: text("outbox_id").notNull().references(() => agentOutbox.id, { onDelete: "cascade" }),
  operationIdentity: text("operation_identity").notNull(),
  state: text("state").notNull(),
  outcomeJson: text("outcome_json"),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("agent_compensations_operation_unique").on(table.operationIdentity)]);

export const candidateDriveObjects = pgTable("candidate_drive_objects", {
  id: text("id").primaryKey(),
  candidateId: integer("candidate_id").notNull().references(() => candidates.id, { onDelete: "cascade" }),
  driveFolderId: text("drive_folder_id").notNull(),
  driveFileId: text("drive_file_id").notNull(),
  providerVersion: text("provider_version").notNull(),
  name: text("name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  modifiedAtUtc: text("modified_at_utc").notNull(),
  inResultsSubtree: boolean("in_results_subtree").notNull().default(false),
}, (table) => [
  uniqueIndex("candidate_drive_object_version_unique").on(table.candidateId, table.driveFileId, table.providerVersion),
  index("candidate_drive_folder_idx").on(table.driveFolderId, table.driveFileId),
  check("candidate_drive_object_size_nonnegative", sql`${table.size} >= 0`),
]);

export const candidateMaterialSnapshots = pgTable("candidate_material_snapshots", {
  id: text("id").primaryKey(),
  candidateId: integer("candidate_id").notNull().references(() => candidates.id, { onDelete: "cascade" }),
  fingerprint: text("fingerprint").notNull(),
  complete: boolean("complete").notNull(),
  stableComparisons: integer("stable_comparisons").notNull().default(0),
  capturedAtUtc: text("captured_at_utc").notNull(),
}, (table) => [
  uniqueIndex("candidate_snapshot_identity_unique").on(table.candidateId, table.id),
  check("candidate_snapshot_stability_bounded", sql`${table.stableComparisons} >= 0 AND ${table.stableComparisons} <= 3`),
]);

export const candidateInputVersions = pgTable("candidate_input_versions", {
  id: text("id").primaryKey(),
  candidateId: integer("candidate_id").notNull().references(() => candidates.id, { onDelete: "cascade" }),
  snapshotId: text("snapshot_id").notNull().references(() => candidateMaterialSnapshots.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  manifestJson: text("manifest_json").notNull(),
  state: text("state").notNull(),
  createdAtUtc: text("created_at_utc").notNull(),
}, (table) => [
  uniqueIndex("candidate_input_sequence_unique").on(table.candidateId, table.sequence),
  check("candidate_input_sequence_positive", sql`${table.sequence} > 0`),
]);

export const candidateMaterialEntries = pgTable("candidate_material_entries", {
  inputVersionId: text("input_version_id").notNull().references(() => candidateInputVersions.id, { onDelete: "cascade" }),
  driveObjectId: text("drive_object_id").notNull().references(() => candidateDriveObjects.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  supported: boolean("supported").notNull(),
}, (table) => [primaryKey({ columns: [table.inputVersionId, table.driveObjectId] })]);

export const candidateDomainArtifacts = pgTable("candidate_domain_artifacts", {
  id: text("id").primaryKey(),
  candidateId: integer("candidate_id").notNull().references(() => candidates.id, { onDelete: "cascade" }),
  runId: text("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
  inputVersionId: text("input_version_id").notNull().references(() => candidateInputVersions.id, { onDelete: "cascade" }),
  profileVersion: text("profile_version").notNull(),
  kind: text("kind").notNull(),
  schemaVersion: text("schema_version").notNull(),
  provider: text("provider"),
  toolVersion: text("tool_version").notNull(),
  configFingerprint: text("config_fingerprint").notNull(),
  protectedTraceId: text("protected_trace_id"),
  parentArtifactId: text("parent_artifact_id"),
  checksum: text("checksum").notNull(),
  payloadRef: text("payload_ref").notNull(),
  createdAtUtc: text("created_at_utc").notNull(),
}, (table) => [
  uniqueIndex("candidate_artifact_checksum_unique").on(table.candidateId, table.kind, table.checksum),
  index("candidate_artifact_scope_idx").on(table.candidateId, table.runId, table.inputVersionId, table.kind),
]);

export const candidateEvidenceLocators = pgTable("candidate_evidence_locators", {
  id: text("id").primaryKey(),
  artifactId: text("artifact_id").notNull().references(() => candidateDomainArtifacts.id, { onDelete: "cascade" }),
  sourceKind: text("source_kind").notNull(),
  sourceIdentity: text("source_identity").notNull(),
  sourceVersion: text("source_version").notNull(),
  exactText: text("exact_text").notNull(),
  locatorJson: text("locator_json").notNull(),
  confidenceMicros: integer("confidence_micros"),
}, (table) => [
  index("candidate_locator_source_idx").on(table.sourceKind, table.sourceIdentity, table.sourceVersion),
  check("candidate_locator_confidence", sql`${table.confidenceMicros} IS NULL OR (${table.confidenceMicros} >= 0 AND ${table.confidenceMicros} <= 1000000)`),
]);

export const candidateFacts = pgTable("candidate_facts", {
  id: text("id").primaryKey(),
  artifactId: text("artifact_id").notNull().references(() => candidateDomainArtifacts.id, { onDelete: "cascade" }),
  locatorId: text("locator_id").notNull().references(() => candidateEvidenceLocators.id, { onDelete: "cascade" }),
  predicate: text("predicate").notNull(),
  valueJson: text("value_json").notNull(),
  significant: boolean("significant").notNull(),
  conflictGroup: text("conflict_group"),
});

export const candidateAssessments = pgTable("candidate_assessments", {
  id: text("id").primaryKey(),
  artifactId: text("artifact_id").notNull().references(() => candidateDomainArtifacts.id, { onDelete: "cascade" }),
  predecessorId: text("predecessor_id"),
  attempt: integer("attempt").notNull(),
  recommendation: text("recommendation").notNull(),
  formulaVersion: text("formula_version").notNull(),
  gateState: text("gate_state").notNull(),
  decisionEvidenceJson: text("decision_evidence_json").notNull(),
}, (table) => [check("candidate_assessment_attempt_positive", sql`${table.attempt} > 0`)]);

export const candidateReportVersions = pgTable("candidate_report_versions", {
  id: text("id").primaryKey(),
  candidateId: integer("candidate_id").notNull().references(() => candidates.id, { onDelete: "cascade" }),
  runId: text("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
  assessmentId: text("assessment_id").notNull().references(() => candidateAssessments.id, { onDelete: "cascade" }),
  analysisVersion: integer("analysis_version").notNull(),
  state: text("state").notNull(),
  directoryIdentity: text("directory_identity").notNull(),
}, (table) => [
  uniqueIndex("candidate_report_version_unique").on(table.candidateId, table.analysisVersion),
  check("candidate_report_analysis_version_positive", sql`${table.analysisVersion} > 0`),
]);

export const candidateReportDocuments = pgTable("candidate_report_documents", {
  id: text("id").primaryKey(),
  reportVersionId: text("report_version_id").notNull().references(() => candidateReportVersions.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["candidate-results", "abc-test"] }).notNull(),
  fileName: text("file_name").notNull(),
  checksum: text("checksum").notNull(),
  byteSize: integer("byte_size").notNull(),
  driveFileId: text("drive_file_id"),
  validationJson: text("validation_json").notNull(),
}, (table) => [
  uniqueIndex("candidate_report_document_type_unique").on(table.reportVersionId, table.type),
  check("candidate_report_document_size_positive", sql`${table.byteSize} > 0`),
]);

export const candidateNotificationEvents = pgTable("candidate_notification_events", {
  id: text("id").primaryKey(),
  candidateId: integer("candidate_id").notNull().references(() => candidates.id, { onDelete: "cascade" }),
  runId: text("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
  logicalKey: text("logical_key").notNull(),
  type: text("type").notNull(),
  safePayloadJson: text("safe_payload_json").notNull(),
  createdAtUtc: text("created_at_utc").notNull(),
}, (table) => [uniqueIndex("candidate_notification_logical_key_unique").on(table.logicalKey)]);

export const candidateNotificationDeliveries = pgTable("candidate_notification_deliveries", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull().references(() => candidateNotificationEvents.id, { onDelete: "cascade" }),
  recipientRef: text("recipient_ref").notNull(),
  state: text("state").notNull(),
  attempts: integer("attempts").notNull().default(0),
  providerMessageId: text("provider_message_id"),
  nextAttemptAtUtc: text("next_attempt_at_utc"),
}, (table) => [
  uniqueIndex("candidate_notification_recipient_unique").on(table.eventId, table.recipientRef),
  check("candidate_notification_attempts_nonnegative", sql`${table.attempts} >= 0`),
]);

export const candidateStageMetrics = pgTable("candidate_stage_metrics", {
  id: text("id").primaryKey(),
  candidateId: integer("candidate_id").notNull().references(() => candidates.id, { onDelete: "cascade" }),
  runId: text("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
  stage: text("stage").notNull(),
  configFingerprint: text("config_fingerprint").notNull(),
  startedAtUtc: text("started_at_utc").notNull(),
  endedAtUtc: text("ended_at_utc"),
  durationMs: integer("duration_ms"),
  retryCount: integer("retry_count").notNull().default(0),
  outcome: text("outcome").notNull(),
}, (table) => [
  uniqueIndex("candidate_stage_metric_unique").on(table.runId, table.stage),
  check("candidate_stage_metric_duration_nonnegative", sql`${table.durationMs} IS NULL OR ${table.durationMs} >= 0`),
]);

export const candidateCleanupStates = pgTable("candidate_cleanup_states", {
  candidateId: integer("candidate_id").primaryKey().references(() => candidates.id, { onDelete: "cascade" }),
  driveFolderId: text("drive_folder_id").notNull(),
  state: text("state").notNull(),
  confirmationsJson: text("confirmations_json").notNull(),
  deletedAtUtc: text("deleted_at_utc"),
}, (table) => [uniqueIndex("candidate_cleanup_drive_folder_unique").on(table.driveFolderId)]);

export const artifactBlobs = pgTable("artifact_blobs", {
  id: text("id").primaryKey(),
  scope: text("scope").notNull(),
  kind: text("kind").notNull(),
  checksum: text("checksum").notNull(),
  mimeType: text("mime_type").notNull(),
  byteSize: bigint("byte_size", { mode: "number" }).notNull(),
  content: bytea("content").notNull(),
  retentionUntilUtc: text("retention_until_utc"),
  protected: boolean("protected").notNull().default(false),
  createdAtUtc: text("created_at_utc").notNull(),
}, (table) => [
  uniqueIndex("artifact_blobs_scope_checksum_unique").on(table.scope, table.checksum),
  index("artifact_blobs_retention_idx").on(table.retentionUntilUtc, table.protected),
  check("artifact_blobs_checksum_sha256", sql`${table.checksum} ~ '^[0-9a-f]{64}$'`),
  check("artifact_blobs_size_global", sql`${table.byteSize} > 0 AND ${table.byteSize} <= 33554432`),
]);
