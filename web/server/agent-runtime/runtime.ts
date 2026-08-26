import { createHash } from "node:crypto";
import { createSyntheticRegistries, type GoalRegistry, type ToolRegistry, validatePlan } from "./registry.ts";
import { emptyUsage, type BudgetKind, type BudgetUsage, type Escalation, type EvalDecision, type GoalInput, type MemoryEntry, type OutboxIntent, type RuntimeCheckpoint, type RuntimeEvent, type RuntimeSnapshot, type RuntimeTask, type SideEffectClass, type ToolGrant, type TriggerKind } from "./types.ts";

const nowIso = () => new Date().toISOString();
const clone = <T>(value: T): T => structuredClone(value);

export class RuntimeConflictError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "RuntimeConflictError";
  }
}

export type FeatureFlags = { synthetic: boolean; shadow: boolean; acceptNewGoals: boolean; toolRouting: Record<string, "legacy" | "agent"> };
export type ObstacleClass = "transient" | "repairable" | "replan-required" | "human-required" | "terminal";

export function classifyObstacle(input: { code: string; retryable?: boolean; repairable?: boolean; recoveryTemplate?: string; humanActions?: string[]; policyTerminal?: boolean }): ObstacleClass {
  if (input.policyTerminal) return "terminal";
  if (input.retryable) return "transient";
  if (input.repairable) return "repairable";
  if (input.recoveryTemplate) return "replan-required";
  if (input.humanActions?.length) return "human-required";
  return "terminal";
}

export class DurableAgentRuntime {
  private snapshot: RuntimeSnapshot | null;
  readonly triggerIdentities = new Map<string, string>();
  readonly operationOutcomes = new Map<string, { state: "CONFIRMED" | "ABSENT" | "UNKNOWN"; artifactId?: string }>();
  readonly providerCalls = new Map<string, number>();
  readonly compensations: { identity: string; state: "PENDING" | "SUCCEEDED" | "FAILED"; error?: string }[] = [];
  readonly evalResults: { decision: EvalDecision; policyVersion: string; evaluatorVersion: string; inputs: string[]; violations: string[]; evidenceRefs: string[] }[] = [];
  flags: FeatureFlags = { synthetic: true, shadow: false, acceptNewGoals: true, toolRouting: {} };
  readonly tools: ToolRegistry;
  readonly goals: GoalRegistry;

  constructor(
    tools?: ToolRegistry,
    goals?: GoalRegistry,
    persisted?: RuntimeSnapshot,
  ) {
    const defaults = createSyntheticRegistries();
    this.tools = tools ?? defaults.tools;
    this.goals = goals ?? defaults.goals;
    this.snapshot = persisted ? clone(persisted) : null;
  }

  exportSnapshot() {
    if (!this.snapshot) throw new Error("RUNTIME_NOT_INITIALIZED");
    return clone(this.snapshot);
  }

  createGoal(goal: GoalInput) {
    if (!this.flags.acceptNewGoals) throw new RuntimeConflictError("RUNTIME_CONTROLLED_PAUSE");
    if (this.snapshot) {
      if (this.snapshot.goal.goalId === goal.goalId) return this.exportSnapshot();
      throw new RuntimeConflictError("RUNTIME_ALREADY_INITIALIZED");
    }
    this.validateBudgets(goal.budgets);
    const templates = this.goals.createPlan(goal);
    validatePlan(goal, templates, this.tools, goal);
    const createdAt = nowIso();
    const tasks = templates.map((task, index): RuntimeTask => ({
      ...task,
      id: `${goal.runId}:p1:${task.key}`,
      runId: goal.runId,
      planVersion: 1,
      state: index === 0 ? "RUNNABLE" : "PENDING",
      revision: 1,
      attemptCount: 0,
      idempotencyIdentity: `${goal.runId}:p1:${task.key}`,
    }));
    this.snapshot = {
      goal: clone(goal), state: "ACTIVE", revision: 1,
      plans: [{ version: 1, createdAt, reason: "INITIAL_PLAN", tasks: clone(templates) }], tasks,
      events: [], checkpoints: [], budgets: { limits: clone(goal.budgets), used: emptyUsage(), reserved: emptyUsage() },
      grants: [], memory: [], escalations: [], outbox: [], obstacleFingerprints: [], archived: false, deleted: false, lastProgressAt: createdAt,
    };
    this.append("GOAL_CREATED", "runtime", { goalType: goal.goalType, inputVersion: goal.inputVersion, profileVersion: goal.profileVersion, policyVersion: goal.policyVersion });
    return this.exportSnapshot();
  }

  command(expectedRevision: number, type: string, actor: string, payload: Record<string, unknown>, mutate: (snapshot: RuntimeSnapshot) => void) {
    const current = this.must();
    if (current.revision !== expectedRevision) throw new RuntimeConflictError("STALE_RUNTIME_REVISION");
    const working = clone(current);
    mutate(working);
    working.revision += 1;
    working.lastProgressAt = nowIso();
    this.snapshot = working;
    this.append(type, actor, payload);
    return this.exportSnapshot();
  }

  ingestTrigger(kind: TriggerKind, identity: string, versions: { candidateId: string; inputVersion: string; profileVersion: string }) {
    const state = this.must();
    const previous = this.triggerIdentities.get(identity);
    if (previous) return { accepted: false, duplicate: true, runId: previous };
    if (versions.candidateId !== state.goal.candidateId || versions.inputVersion !== state.goal.inputVersion || versions.profileVersion !== state.goal.profileVersion) {
      this.append("LATE_OR_STALE_TRIGGER", "dispatcher", { kind, identity });
      return { accepted: false, duplicate: false, stale: true, runId: state.goal.runId };
    }
    this.triggerIdentities.set(identity, state.goal.runId);
    this.append("TRIGGER_ACCEPTED", "dispatcher", { kind, identity });
    return { accepted: true, duplicate: false, runId: state.goal.runId };
  }

  promoteEligible() {
    const state = this.must();
    if (state.archived || state.state !== "ACTIVE") return [];
    const completed = new Set(state.tasks.filter((task) => task.state === "SUCCEEDED").map((task) => task.key));
    const promoted: string[] = [];
    for (const task of state.tasks) {
      if (task.state === "PENDING" && task.dependencies.every((dependency) => completed.has(dependency))) {
        task.state = "RUNNABLE";
        task.revision += 1;
        promoted.push(task.id);
        this.append("TASK_PROMOTED", "scheduler", { taskId: task.id }, task.id);
      }
    }
    return promoted;
  }

  claim(worker: string, leaseMs = 30_000, at = Date.now()) {
    const state = this.must();
    if (state.archived || state.state !== "ACTIVE") return null;
    const task = state.tasks.find((item) => item.state === "RUNNABLE");
    if (!task) return null;
    this.reserve({ taskAttempts: 1 });
    task.state = "RUNNING";
    task.attemptCount += 1;
    task.leaseOwner = worker;
    task.leaseToken = (task.leaseToken ?? 0) + 1;
    task.leaseExpiresAt = at + leaseMs;
    task.revision += 1;
    this.commitReservation({ taskAttempts: 1 });
    this.append("TASK_CLAIMED", worker, { leaseToken: task.leaseToken, leaseExpiresAt: task.leaseExpiresAt, attempt: task.attemptCount }, task.id);
    return clone(task);
  }

  heartbeat(taskId: string, worker: string, leaseToken: number, leaseMs = 30_000, at = Date.now()) {
    const task = this.currentTask(taskId, worker, leaseToken);
    if (task.state !== "RUNNING") throw new RuntimeConflictError("TASK_NOT_RUNNING");
    task.leaseExpiresAt = at + leaseMs;
    task.revision += 1;
    this.append("TASK_HEARTBEAT", worker, { leaseToken, leaseExpiresAt: task.leaseExpiresAt }, task.id);
    return clone(task);
  }

  recoverStaleLeases(at = Date.now()) {
    const recovered: string[] = [];
    for (const task of this.must().tasks) {
      if (task.state !== "RUNNING" || !task.leaseExpiresAt || task.leaseExpiresAt > at) continue;
      task.state = this.hasConfirmedCheckpoint(task.id) ? "RUNNABLE" : "UNKNOWN_OUTCOME";
      task.leaseOwner = undefined;
      task.leaseExpiresAt = undefined;
      task.revision += 1;
      recovered.push(task.id);
      this.append("STALE_LEASE_RECOVERED", "scheduler", { outcome: task.state }, task.id);
    }
    return recovered;
  }

  reconcileUnknown(taskId: string) {
    const task = this.task(taskId);
    if (task.state !== "UNKNOWN_OUTCOME") throw new RuntimeConflictError("OUTCOME_NOT_UNKNOWN");
    const outcome = this.operationOutcomes.get(task.idempotencyIdentity);
    if (outcome?.state === "CONFIRMED") {
      task.state = "SUCCEEDED";
      task.outputArtifactId = outcome.artifactId;
    } else if (outcome?.state === "ABSENT") {
      task.state = "RUNNABLE";
    } else {
      task.state = "WAITING";
    }
    task.revision += 1;
    this.append("UNKNOWN_OUTCOME_RECONCILED", "scheduler", { result: outcome?.state ?? "UNKNOWN" }, task.id);
    return clone(task);
  }

  checkpoint(taskId: string, worker: string, leaseToken: number, input: Omit<RuntimeCheckpoint, "id" | "runId" | "taskId" | "attempt" | "leaseToken" | "confirmedAt">) {
    const task = this.currentTask(taskId, worker, leaseToken);
    const identity = `${task.id}:${input.kind}:${input.identity}`;
    const existing = this.must().checkpoints.find((item) => `${item.taskId}:${item.kind}:${item.identity}` === identity);
    if (existing) return clone(existing);
    const checkpoint: RuntimeCheckpoint = { id: `checkpoint-${this.must().checkpoints.length + 1}`, runId: task.runId, taskId, attempt: task.attemptCount, leaseToken, confirmedAt: nowIso(), ...input };
    this.must().checkpoints.push(checkpoint);
    this.append("CHECKPOINT_CONFIRMED", worker, { kind: input.kind, identity: input.identity, remoteJobId: input.remoteJobId }, task.id);
    return clone(checkpoint);
  }

  complete(taskId: string, worker: string, leaseToken: number, artifact?: { id: string; checksum: string }) {
    const task = this.currentTask(taskId, worker, leaseToken);
    if (task.state === "SUCCEEDED") return { accepted: false, duplicate: true, task: clone(task) };
    task.state = "SUCCEEDED";
    task.outputArtifactId = artifact?.id;
    task.revision += 1;
    if (artifact) {
      this.operationOutcomes.set(task.idempotencyIdentity, { state: "CONFIRMED", artifactId: artifact.id });
      this.addMemory({ kind: "artifact", purpose: task.key, provenance: task.id, sensitivity: "confidential", immutable: true, artifactRef: artifact.id, checksum: artifact.checksum });
    }
    this.append("TASK_COMPLETED", worker, { artifactId: artifact?.id }, task.id);
    this.promoteEligible();
    return { accepted: true, duplicate: false, task: clone(task) };
  }

  fail(taskId: string, worker: string, leaseToken: number, code: string, recoverable: boolean) {
    const task = this.currentTask(taskId, worker, leaseToken);
    task.state = recoverable ? "RUNNABLE" : "FAILED";
    task.revision += 1;
    this.append("TASK_FAILED", worker, { code, recoverable, attempt: task.attemptCount }, task.id);
    return clone(task);
  }

  issueGrant(input: Omit<ToolGrant, "id">) {
    this.tools.get(input.toolKey);
    const grant: ToolGrant = { id: `grant-${this.must().grants.length + 1}`, ...clone(input) };
    this.must().grants.push(grant);
    this.append("TOOL_GRANT_ISSUED", "policy", { grantId: grant.id, toolKey: grant.toolKey, sideEffectClass: grant.sideEffectClass });
    return clone(grant);
  }

  revokeGrant(id: string, at = Date.now()) {
    const grant = this.must().grants.find((item) => item.id === id);
    if (!grant) throw new RuntimeConflictError("GRANT_NOT_FOUND");
    grant.revokedAt = at;
    this.append("TOOL_GRANT_REVOKED", "policy", { grantId: id });
  }

  authorizeTool(input: { grantId?: string; toolKey: string; candidateId: string; runId: string; inputVersion: string; policyVersion: string; operation: string; sideEffectClass: SideEffectClass; at?: number }) {
    const state = this.must();
    const grant = input.grantId ? state.grants.find((item) => item.id === input.grantId) : undefined;
    let code: string | null = null;
    if (!grant) code = "GRANT_ABSENT";
    else if (grant.revokedAt || grant.expiresAt <= (input.at ?? Date.now())) code = "GRANT_EXPIRED";
    else if ([grant.toolKey !== input.toolKey, grant.candidateId !== input.candidateId, grant.runId !== input.runId, grant.inputVersion !== input.inputVersion, grant.policyVersion !== input.policyVersion, !grant.operations.includes(input.operation)].some(Boolean)) code = "GRANT_SCOPE_MISMATCH";
    else if (!this.tools.allowsSideEffect(grant.sideEffectClass, input.sideEffectClass)) code = "GRANT_SIDE_EFFECT_DENIED";
    if (code) {
      this.append("TOOL_POLICY_DENIED", "policy", { code, toolKey: input.toolKey, operation: input.operation, requestedSideEffectClass: input.sideEffectClass });
      return { allowed: false, code, secretResolved: false };
    }
    return { allowed: true, code: null, secretResolved: false };
  }

  reserve(amount: Partial<BudgetUsage>) {
    const budgets = this.must().budgets;
    for (const [kind, value] of Object.entries(amount) as [BudgetKind, number][]) {
      if (!Number.isFinite(value) || value < 0 || budgets.used[kind] + budgets.reserved[kind] + value > budgets.limits[kind]) {
        this.append("BUDGET_DENIED", "policy", { kind, obstacle: "BUDGET_EXHAUSTED" });
        throw new RuntimeConflictError(`BUDGET_EXHAUSTED:${kind}`);
      }
    }
    for (const [kind, value] of Object.entries(amount) as [BudgetKind, number][]) budgets.reserved[kind] += value;
    this.append("BUDGET_RESERVED", "policy", { amount });
  }

  commitReservation(actual: Partial<BudgetUsage>) {
    const budgets = this.must().budgets;
    for (const [kind, value] of Object.entries(actual) as [BudgetKind, number][]) {
      if (value > budgets.reserved[kind]) throw new RuntimeConflictError(`BUDGET_COMMIT_EXCEEDS_RESERVATION:${kind}`);
      budgets.reserved[kind] -= value;
      budgets.used[kind] += value;
    }
    this.append("BUDGET_COMMITTED", "policy", { actual });
  }

  releaseReservation(amount: Partial<BudgetUsage>) {
    for (const [kind, value] of Object.entries(amount) as [BudgetKind, number][]) this.must().budgets.reserved[kind] = Math.max(0, this.must().budgets.reserved[kind] - value);
    this.append("BUDGET_RELEASED", "policy", { amount });
  }

  reconcileReservation(amount: Partial<BudgetUsage>, actual: Partial<BudgetUsage>) {
    this.releaseReservation(amount);
    this.reserve(actual);
    this.commitReservation(actual);
  }

  addMemory(input: Pick<MemoryEntry, "kind" | "purpose" | "provenance" | "sensitivity" | "immutable"> & Partial<Pick<MemoryEntry, "payload" | "artifactRef" | "checksum">>) {
    const state = this.must();
    const entry: MemoryEntry = { id: `memory-${state.memory.length + 1}`, candidateId: state.goal.candidateId, runId: state.goal.runId, inputVersion: state.goal.inputVersion, profileVersion: state.goal.profileVersion, ...clone(input) };
    state.memory.push(entry);
    this.append("MEMORY_ADDED", "runtime", { id: entry.id, kind: entry.kind, purpose: entry.purpose, artifactRef: entry.artifactRef });
    return clone(entry);
  }

  supersedeWorkingMemory(id: string) {
    const entry = this.must().memory.find((item) => item.id === id && item.kind === "working");
    if (!entry) throw new RuntimeConflictError("WORKING_MEMORY_NOT_FOUND");
    entry.supersededAt = nowIso();
    this.append("WORKING_MEMORY_SUPERSEDED", "runtime", { id });
  }

  contextManifest(input: { candidateId: string; runId: string; purpose: string; allowSensitivities: MemoryEntry["sensitivity"][] }) {
    const state = this.must();
    if (input.candidateId !== state.goal.candidateId || input.runId !== state.goal.runId) throw new RuntimeConflictError("CONTEXT_SCOPE_DENIED");
    return state.memory.filter((entry) => !entry.supersededAt
      && (entry.runId === input.runId || entry.sensitivity === "non-personal-policy")
      && (entry.purpose === input.purpose || entry.sensitivity === "non-personal-policy")
      && input.allowSensitivities.includes(entry.sensitivity))
      .map((entry) => {
        const manifestEntry = clone(entry);
        delete manifestEntry.payload;
        return manifestEntry;
      });
  }

  evaluate(decision: EvalDecision, input: { evaluatorVersion?: string; artifactInputs: string[]; violations?: string[]; evidenceRefs?: string[] }) {
    const result = { decision, policyVersion: this.must().goal.policyVersion, evaluatorVersion: input.evaluatorVersion ?? "deterministic-gates/v1", inputs: clone(input.artifactInputs), violations: clone(input.violations ?? []), evidenceRefs: clone(input.evidenceRefs ?? []) };
    this.evalResults.push(result);
    this.append("EVAL_COMPLETED", "evaluator", result);
    return clone(result);
  }

  fingerprint(code: string, evidenceIdentities: string[]) {
    return createHash("sha256").update(`${code}\0${[...evidenceIdentities].sort().join("\0")}`).digest("hex");
  }

  createRepair(fingerprint: string, expectedChange: string, evidenceChanged: boolean) {
    const state = this.must();
    if (state.obstacleFingerprints.includes(fingerprint) && !evidenceChanged) {
      this.append("REPAIR_LOOP_BLOCKED", "policy", { fingerprint });
      return null;
    }
    this.reserve({ repairAttempts: 1 });
    const task: RuntimeTask = { key: `repair-${state.tasks.length + 1}`, tool: "synthetic.repair/v1", dependencies: [], expectedOutputs: [expectedChange], completionGate: "repair-re-evaluation", id: `${state.goal.runId}:p${state.plans.at(-1)!.version}:repair-${state.tasks.length + 1}`, runId: state.goal.runId, planVersion: state.plans.at(-1)!.version, state: "RUNNABLE", revision: 1, attemptCount: 0, idempotencyIdentity: `${state.goal.runId}:repair:${fingerprint}` };
    state.tasks.push(task);
    state.obstacleFingerprints.push(fingerprint);
    this.commitReservation({ repairAttempts: 1 });
    this.append("REPAIR_CREATED", "runtime", { fingerprint, expectedChange }, task.id);
    return clone(task);
  }

  replan(template: string, fingerprint: string) {
    const state = this.must();
    this.reserve({ replans: 1 });
    const previous = state.plans.at(-1)!;
    const nextTasks = this.goals.recover(state.goal.goalType, template, previous.tasks);
    validatePlan(state.goal, nextTasks, this.tools, state.goal);
    const previousKeys = new Set(previous.tasks.map((item) => item.key));
    const nextKeys = new Set(nextTasks.map((item) => item.key));
    const mapping = {
      reused: [...nextKeys].filter((key) => previousKeys.has(key)),
      replaced: previous.tasks.filter((item) => item.recoveryTemplate === template || (item.key === "assessment" && !nextKeys.has(item.key))).map((item) => item.key),
      added: [...nextKeys].filter((key) => !previousKeys.has(key)),
      cancelled: [...previousKeys].filter((key) => !nextKeys.has(key)),
    };
    state.plans.push({ version: previous.version + 1, createdAt: nowIso(), reason: "OBSTACLE_REPLAN", obstacleFingerprint: fingerprint, tasks: clone(nextTasks), mapping });
    this.commitReservation({ replans: 1 });
    this.append("PLAN_REPLACED", "runtime", { previousVersion: previous.version, nextVersion: previous.version + 1, template, fingerprint, mapping });
    return clone(state.plans.at(-1)!);
  }

  escalate(input: { obstacle: string; safeSummary: string; impact: string; evidence: string[]; reusableArtifacts: string[]; actions: Escalation["actions"] }) {
    const state = this.must();
    if (!input.actions.length || !input.safeSummary.trim()) {
      state.state = "FAILED";
      this.append("TERMINAL_OUTCOME", "runtime", { code: "UNSAFE_OR_ACTIONLESS_ESCALATION" });
      return null;
    }
    const escalation: Escalation = { id: `escalation-${state.escalations.length + 1}`, runId: state.goal.runId, version: 1, state: "OPEN", obstacle: input.obstacle, obstacleFingerprint: this.fingerprint(input.obstacle, input.evidence), safeSummary: input.safeSummary, impact: input.impact, attempts: state.budgets.used.taskAttempts, budgets: clone(state.budgets.used), evidence: clone(input.evidence), reusableArtifacts: clone(input.reusableArtifacts), actions: clone(input.actions) };
    state.escalations.push(escalation);
    state.state = "WAITING_FOR_HUMAN";
    this.append("ESCALATION_OPENED", "runtime", { escalationId: escalation.id, version: escalation.version, obstacle: escalation.obstacle, actions: escalation.actions.map((item) => item.key) });
    return clone(escalation);
  }

  resolveEscalation(input: { id: string; version: number; action: string; actor: string; authorized: boolean; newInputVersion?: string; newProfileVersion?: string }) {
    const state = this.must();
    const escalation = state.escalations.find((item) => item.id === input.id);
    if (!input.authorized) return { accepted: false, code: "UNAUTHORIZED_RESOLUTION" };
    if (!escalation || escalation.state !== "OPEN" || escalation.version !== input.version) return { accepted: false, code: "STALE_ESCALATION_VERSION", current: escalation ? clone(escalation) : undefined };
    const action = escalation.actions.find((item) => item.key === input.action);
    if (!action) return { accepted: false, code: "ACTION_NOT_ALLOWED" };
    escalation.state = "RESOLVED";
    escalation.version += 1;
    if (!action.changesImmutableInputs) {
      state.state = "ACTIVE";
      this.append("RUN_RESUMED", input.actor, { escalationId: escalation.id, action: action.key, sameRun: true });
      return { accepted: true, sameRun: true, runId: state.goal.runId };
    }
    state.state = "SUPERSEDED";
    const newRun = `${state.goal.runId}-superseding-${state.plans.length + 1}`;
    this.append("RUN_SUPERSEDED", input.actor, { escalationId: escalation.id, action: action.key, newRun, newInputVersion: input.newInputVersion, newProfileVersion: input.newProfileVersion });
    return { accepted: true, sameRun: false, previousRunState: "SUPERSEDED" as const, runId: newRun, linkedEscalationId: escalation.id, inputVersion: input.newInputVersion ?? state.goal.inputVersion, profileVersion: input.newProfileVersion ?? state.goal.profileVersion };
  }

  createIntent(operationIdentity: string, sideEffectClass: SideEffectClass) {
    const state = this.must();
    const existing = state.outbox.find((item) => item.operationIdentity === operationIdentity);
    if (existing) return clone(existing);
    const intent: OutboxIntent = { id: `intent-${state.outbox.length + 1}`, runId: state.goal.runId, operationIdentity, state: "PENDING", candidateReady: false, attempts: 0 };
    state.outbox.push(intent);
    this.append("SIDE_EFFECT_INTENT_CREATED", "runtime", { intentId: intent.id, operationIdentity, sideEffectClass });
    return clone(intent);
  }

  executeIntent(operationIdentity: string, effect: () => { state: "CONFIRMED" | "UNKNOWN"; artifactId?: string }, input: { grantId: string; toolKey: string; operation: string; sideEffectClass: SideEffectClass }) {
    const state = this.must();
    const intent = state.outbox.find((item) => item.operationIdentity === operationIdentity);
    if (!intent) throw new RuntimeConflictError("DURABLE_INTENT_REQUIRED");
    const auth = this.authorizeTool({ ...input, candidateId: state.goal.candidateId, runId: state.goal.runId, inputVersion: state.goal.inputVersion, policyVersion: state.goal.policyVersion });
    if (!auth.allowed) return { called: false, ...auth };
    const prior = this.operationOutcomes.get(operationIdentity);
    if (prior?.state === "CONFIRMED") return { called: false, reconciled: true, outcome: clone(prior) };
    this.reserve({ externalRequests: 1 });
    intent.state = "SENDING";
    intent.attempts += 1;
    this.providerCalls.set(operationIdentity, (this.providerCalls.get(operationIdentity) ?? 0) + 1);
    const result = effect();
    this.commitReservation({ externalRequests: 1 });
    if (result.state === "CONFIRMED") {
      intent.state = "SENT";
      this.operationOutcomes.set(operationIdentity, { state: "CONFIRMED", artifactId: result.artifactId });
    } else {
      intent.state = "UNKNOWN_OUTCOME";
      this.operationOutcomes.set(operationIdentity, { state: "UNKNOWN" });
    }
    this.append("SIDE_EFFECT_OUTCOME", "worker", { operationIdentity, state: result.state, artifactId: result.artifactId });
    return { called: true, outcome: result };
  }

  compensate(identity: string, action: () => void) {
    const item = { identity, state: "PENDING" as const };
    this.compensations.push(item);
    this.append("COMPENSATION_INTENT_CREATED", "runtime", { identity });
    try {
      action();
      this.compensations[this.compensations.length - 1] = { identity, state: "SUCCEEDED" };
      this.append("COMPENSATION_SUCCEEDED", "worker", { identity });
    } catch (error) {
      this.compensations[this.compensations.length - 1] = { identity, state: "FAILED", error: error instanceof Error ? error.message : "COMPENSATION_FAILED" };
      this.append("COMPENSATION_FAILED", "worker", { identity, code: "COMPENSATION_FAILED" });
    }
    return clone(this.compensations.at(-1)!);
  }

  determineOutcome(completionEvidence: string[]) {
    const state = this.must();
    if (state.state !== "ACTIVE") return state.state;
    const requiredComplete = state.goal.completionCriteria.every((criterion) => completionEvidence.includes(criterion));
    const tasksComplete = state.tasks.filter((task) => !task.key.startsWith("repair-")).every((task) => ["SUCCEEDED", "CANCELLED"].includes(task.state));
    const effectsConfirmed = state.outbox.filter((item) => item.operationIdentity.includes("publication")).every((item) => item.state === "SENT");
    if (requiredComplete && tasksComplete && effectsConfirmed) {
      state.state = "SUCCEEDED";
      this.append("GOAL_SUCCEEDED", "runtime", { completionEvidence });
    } else if (!state.tasks.some((task) => ["RUNNABLE", "RUNNING", "PENDING", "WAITING", "UNKNOWN_OUTCOME"].includes(task.state))) {
      this.append("PLANNING_OBSTACLE", "runtime", { code: "EMPTY_QUEUE_WITHOUT_COMPLETION" });
    }
    return state.state;
  }

  archive() {
    const state = this.must();
    state.archived = true;
    for (const task of state.tasks) if (["RUNNABLE", "RUNNING", "PENDING", "WAITING", "UNKNOWN_OUTCOME"].includes(task.state)) task.state = "CANCELLED";
    for (const grant of state.grants) grant.revokedAt = Date.now();
    this.append("CANDIDATE_RUNTIME_ARCHIVED", "lifecycle", { candidateId: state.goal.candidateId });
  }

  controlledPause() {
    this.flags.acceptNewGoals = false;
    const state = this.must();
    if (["ACTIVE", "WAITING_FOR_HUMAN"].includes(state.state)) state.state = "PAUSED";
    this.append("RUNTIME_CONTROLLED_PAUSE", "operator", { checkpointsPreserved: true });
  }

  deleteCandidateRuntime() {
    const state = this.must();
    this.archive();
    state.memory = state.memory.filter((entry) => entry.sensitivity === "non-personal-policy");
    state.checkpoints = [];
    state.escalations = [];
    state.outbox = [];
    state.deleted = true;
    this.append("CANDIDATE_RUNTIME_DELETED", "lifecycle", { tombstone: { candidateIdentity: state.goal.candidateId, cleanupState: "COMPLETE" } });
  }

  projection() {
    const state = this.must();
    return {
      goalId: state.goal.goalId, runId: state.goal.runId, state: state.state, planVersion: state.plans.at(-1)?.version,
      tasks: state.tasks.map(({ id, key, state, attemptCount, leaseOwner, leaseToken, leaseExpiresAt }) => ({ id, key, state, attemptCount, leaseOwner, leaseToken, leaseExpiresAt })),
      budgets: clone(state.budgets), gates: clone(this.evalResults), obstacle: state.events.findLast((event) => ["BUDGET_DENIED", "PLANNING_OBSTACLE", "REPAIR_LOOP_BLOCKED"].includes(event.type)),
      escalation: clone(state.escalations.findLast((item) => item.state === "OPEN")), lastProgressAt: state.lastProgressAt,
    };
  }

  metrics() {
    const state = this.must();
    const durations = { queueWaitMs: 0, executionMs: 0, providerWaitMs: 0, repairOverheadMs: 0, replanOverheadMs: 0, humanWaitMs: 0 };
    return { runId: state.goal.runId, planVersion: state.plans.at(-1)?.version, ...durations, attempts: state.budgets.used.taskAttempts, noPersonalContent: true };
  }

  timeline() {
    return this.must().events.map((event) => `${event.sequence}. ${event.at} ${event.type}${event.taskId ? ` [${event.taskId}]` : ""}`);
  }

  private validateBudgets(limits: GoalInput["budgets"]) {
    for (const kind of Object.keys(emptyUsage()) as BudgetKind[]) if (!Number.isFinite(limits[kind]) || limits[kind] <= 0) throw new Error(`INVALID_BUDGET_LIMIT:${kind}`);
  }

  private must() {
    if (!this.snapshot) throw new Error("RUNTIME_NOT_INITIALIZED");
    return this.snapshot;
  }

  private task(id: string) {
    const task = this.must().tasks.find((item) => item.id === id);
    if (!task) throw new RuntimeConflictError("TASK_NOT_FOUND");
    return task;
  }

  private currentTask(id: string, worker: string, leaseToken: number) {
    const task = this.task(id);
    if (task.leaseOwner !== worker || task.leaseToken !== leaseToken) throw new RuntimeConflictError("STALE_LEASE_TOKEN");
    return task;
  }

  private hasConfirmedCheckpoint(taskId: string) {
    return this.must().checkpoints.some((checkpoint) => checkpoint.taskId === taskId);
  }

  private append(type: string, actor: string, safePayload: Record<string, unknown>, taskId?: string) {
    const state = this.must();
    const event: RuntimeEvent = { id: `event-${state.events.length + 1}`, sequence: state.events.length + 1, runId: state.goal.runId, type, at: nowIso(), actor, planVersion: state.plans.at(-1)?.version ?? 1, taskId, safePayload: clone(safePayload) };
    state.events.push(event);
    state.lastProgressAt = event.at;
    return event;
  }
}
