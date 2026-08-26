export type GoalState = "ACTIVE" | "WAITING_FOR_HUMAN" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "SUPERSEDED" | "PAUSED";
export type TaskState = "PENDING" | "RUNNABLE" | "RUNNING" | "WAITING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "UNKNOWN_OUTCOME";
export type SideEffectClass = "read-only" | "idempotent-write" | "reversible-write" | "irreversible-write";
export type EvalDecision = "PASS" | "REPAIRABLE" | "REPLAN_REQUIRED" | "HUMAN_REQUIRED";
export type BudgetKind = "wallTimeMs" | "taskAttempts" | "repairAttempts" | "replans" | "llmCalls" | "tokens" | "costMicrounits" | "externalRequests";
export type TriggerKind = "input-ready" | "manual-start" | "provider-completion" | "timer" | "configuration" | "human-resolution";

export type BudgetLimits = Record<BudgetKind, number>;
export type BudgetUsage = Record<BudgetKind, number>;

export type GoalInput = {
  goalType: string;
  goalId: string;
  runId: string;
  candidateId: string;
  inputVersion: string;
  profileVersion: string;
  policyVersion: string;
  completionCriteriaVersion: string;
  completionCriteria: string[];
  budgets: BudgetLimits;
};

export type PlanTaskTemplate = {
  key: string;
  tool: string;
  dependencies: string[];
  expectedOutputs: string[];
  completionGate?: string;
  recoveryTemplate?: string;
};

export type PlanVersion = {
  version: number;
  createdAt: string;
  reason: string;
  obstacleFingerprint?: string;
  tasks: readonly PlanTaskTemplate[];
  mapping?: { reused: string[]; replaced: string[]; added: string[]; cancelled: string[] };
};

export type RuntimeTask = PlanTaskTemplate & {
  id: string;
  runId: string;
  planVersion: number;
  state: TaskState;
  revision: number;
  attemptCount: number;
  leaseOwner?: string;
  leaseToken?: number;
  leaseExpiresAt?: number;
  idempotencyIdentity: string;
  outputArtifactId?: string;
};

export type RuntimeEvent = {
  id: string;
  sequence: number;
  runId: string;
  type: string;
  at: string;
  actor: string;
  planVersion: number;
  taskId?: string;
  safePayload: Record<string, unknown>;
};

export type RuntimeCheckpoint = {
  id: string;
  runId: string;
  taskId: string;
  attempt: number;
  leaseToken: number;
  kind: string;
  identity: string;
  checksum?: string;
  remoteJobId?: string;
  confirmedAt: string;
};

export type ToolDefinition = {
  key: string;
  version: string;
  inputSchemaVersion: string;
  outputSchemaVersion: string;
  timeoutClass: string;
  retryClass: "none" | "transient";
  sideEffectClass: SideEffectClass;
  idempotency: "none" | "identity" | "provider-key";
  checkpoint: "none" | "artifact" | "remote-job";
  requiredSecrets: string[];
  compensation?: string;
  recoveryActions: string[];
};

export type ToolGrant = {
  id: string;
  toolKey: string;
  candidateId: string;
  runId: string;
  inputVersion: string;
  policyVersion: string;
  sideEffectClass: SideEffectClass;
  operations: string[];
  budgetLink: string;
  expiresAt: number;
  revokedAt?: number;
};

export type MemoryEntry = {
  id: string;
  candidateId: string;
  runId: string;
  inputVersion: string;
  profileVersion: string;
  kind: "working" | "artifact" | "evidence" | "decision" | "event" | "policy";
  provenance: string;
  sensitivity: "personal" | "confidential" | "non-personal-policy";
  purpose: string;
  payload?: unknown;
  artifactRef?: string;
  checksum?: string;
  supersededAt?: string;
  immutable: boolean;
};

export type Escalation = {
  id: string;
  runId: string;
  version: number;
  state: "OPEN" | "RESOLVED" | "SUPERSEDED";
  obstacle: string;
  obstacleFingerprint: string;
  safeSummary: string;
  impact: string;
  attempts: number;
  budgets: BudgetUsage;
  evidence: string[];
  reusableArtifacts: string[];
  actions: { key: string; schemaVersion: string; changesImmutableInputs: boolean }[];
};

export type OutboxIntent = {
  id: string;
  runId: string;
  operationIdentity: string;
  state: "PENDING" | "SENDING" | "SENT" | "FAILED" | "UNKNOWN_OUTCOME";
  candidateReady: boolean;
  attempts: number;
};

export type RuntimeSnapshot = {
  goal: GoalInput;
  state: GoalState;
  revision: number;
  plans: PlanVersion[];
  tasks: RuntimeTask[];
  events: RuntimeEvent[];
  checkpoints: RuntimeCheckpoint[];
  budgets: { limits: BudgetLimits; used: BudgetUsage; reserved: BudgetUsage };
  grants: ToolGrant[];
  memory: MemoryEntry[];
  escalations: Escalation[];
  outbox: OutboxIntent[];
  obstacleFingerprints: string[];
  archived: boolean;
  deleted: boolean;
  lastProgressAt: string;
};

export function emptyUsage(): BudgetUsage {
  return { wallTimeMs: 0, taskAttempts: 0, repairAttempts: 0, replans: 0, llmCalls: 0, tokens: 0, costMicrounits: 0, externalRequests: 0 };
}
