import type { GoalInput, PlanTaskTemplate, ToolDefinition } from "./types.ts";

const SIDE_EFFECT_ORDER = ["read-only", "idempotent-write", "reversible-write", "irreversible-write"] as const;

export class ToolRegistry {
  readonly tools = new Map<string, ToolDefinition>();

  register(definition: ToolDefinition) {
    const identity = `${definition.key}@${definition.version}`;
    if (this.tools.has(identity)) throw new Error(`TOOL_ALREADY_REGISTERED:${identity}`);
    this.tools.set(identity, structuredClone(definition));
    return identity;
  }

  get(key: string, version = "1") {
    const definition = this.tools.get(`${key}@${version}`);
    if (!definition) throw new Error(`UNSUPPORTED_TOOL:${key}@${version}`);
    return structuredClone(definition);
  }

  allowsSideEffect(granted: ToolDefinition["sideEffectClass"], requested: ToolDefinition["sideEffectClass"]) {
    return SIDE_EFFECT_ORDER.indexOf(granted) >= SIDE_EFFECT_ORDER.indexOf(requested);
  }
}

export type GoalTypeDefinition = {
  key: string;
  policyVersions: string[];
  completionCriteriaVersions: string[];
  plan: (goal: GoalInput) => PlanTaskTemplate[];
  recoveryTemplates: Record<string, (tasks: readonly PlanTaskTemplate[]) => PlanTaskTemplate[]>;
};

export class GoalRegistry {
  readonly goals = new Map<string, GoalTypeDefinition>();

  register(definition: GoalTypeDefinition) {
    if (this.goals.has(definition.key)) throw new Error(`GOAL_TYPE_ALREADY_REGISTERED:${definition.key}`);
    this.goals.set(definition.key, definition);
  }

  createPlan(goal: GoalInput) {
    const definition = this.goals.get(goal.goalType);
    if (!definition) throw new Error(`UNSUPPORTED_GOAL_TYPE:${goal.goalType}`);
    if (!definition.policyVersions.includes(goal.policyVersion)) throw new Error(`UNSUPPORTED_POLICY:${goal.policyVersion}`);
    if (!definition.completionCriteriaVersions.includes(goal.completionCriteriaVersion)) throw new Error(`UNSUPPORTED_COMPLETION_CRITERIA:${goal.completionCriteriaVersion}`);
    return structuredClone(definition.plan(goal));
  }

  recover(goalType: string, template: string, tasks: readonly PlanTaskTemplate[]) {
    const recovery = this.goals.get(goalType)?.recoveryTemplates[template];
    if (!recovery) throw new Error(`UNSUPPORTED_RECOVERY_TEMPLATE:${template}`);
    return structuredClone(recovery(tasks));
  }
}

export function validatePlan(
  goal: GoalInput,
  tasks: readonly PlanTaskTemplate[],
  registry: ToolRegistry,
  current: { inputVersion: string; profileVersion: string },
) {
  if (goal.inputVersion !== current.inputVersion) throw new Error("STALE_INPUT_VERSION");
  if (goal.profileVersion !== current.profileVersion) throw new Error("STALE_PROFILE_VERSION");
  if (!goal.completionCriteria.length || !tasks.some((task) => task.completionGate)) throw new Error("MISSING_COMPLETION_GATE");
  const byKey = new Map(tasks.map((task) => [task.key, task]));
  if (byKey.size !== tasks.length) throw new Error("DUPLICATE_TASK_KEY");
  for (const task of tasks) {
    registry.get(task.tool);
    for (const dependency of task.dependencies) if (!byKey.has(dependency)) throw new Error(`MISSING_DEPENDENCY:${dependency}`);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string) => {
    if (visiting.has(key)) throw new Error("PLAN_CYCLE");
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dependency of byKey.get(key)?.dependencies ?? []) visit(dependency);
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of byKey.keys()) visit(key);
  return true;
}

export function createSyntheticRegistries() {
  const tools = new ToolRegistry();
  const register = (key: string, sideEffectClass: ToolDefinition["sideEffectClass"], checkpoint: ToolDefinition["checkpoint"], extra: Partial<ToolDefinition> = {}) => tools.register({
    key,
    version: "1",
    inputSchemaVersion: "1.0",
    outputSchemaVersion: "1.0",
    timeoutClass: "short-external",
    retryClass: "transient",
    sideEffectClass,
    idempotency: sideEffectClass === "read-only" ? "none" : "identity",
    checkpoint,
    requiredSecrets: [],
    recoveryActions: ["reconcile"],
    ...extra,
  });
  register("synthetic.transcript/v1", "idempotent-write", "remote-job");
  register("synthetic.assessment/v1", "idempotent-write", "artifact");
  register("synthetic.evaluate/v1", "read-only", "artifact");
  register("synthetic.repair/v1", "idempotent-write", "artifact");
  register("synthetic.publish-pdf/v1", "reversible-write", "artifact", { compensation: "synthetic.delete-pdf/v1" });
  register("synthetic.notify/v1", "irreversible-write", "artifact");
  register("transcription.pipeline/v1", "idempotent-write", "remote-job", { requiredSecrets: ["ASSEMBLYAI_API_KEY"] });
  register("llm.protected-trace/v1", "idempotent-write", "artifact", { requiredSecrets: ["ROUTERAI_API_KEY"] });

  const goals = new GoalRegistry();
  goals.register({
    key: "synthetic-candidate-processing/v1",
    policyVersions: ["agent-policy-v1"],
    completionCriteriaVersions: ["synthetic-completion-v1"],
    plan: () => [
      { key: "transcription", tool: "synthetic.transcript/v1", dependencies: [], expectedOutputs: ["transcript-artifact"] },
      { key: "assessment", tool: "synthetic.assessment/v1", dependencies: ["transcription"], expectedOutputs: ["assessment-artifact"] },
      { key: "evaluation", tool: "synthetic.evaluate/v1", dependencies: ["assessment"], expectedOutputs: ["eval-result"] },
      { key: "publication", tool: "synthetic.publish-pdf/v1", dependencies: ["evaluation"], expectedOutputs: ["abc-pdf", "result-pdf"], completionGate: "publication-visible-as-complete-pair" },
      { key: "notification", tool: "synthetic.notify/v1", dependencies: ["publication"], expectedOutputs: ["notification-outcome"], completionGate: "all-required-effects-confirmed" },
    ],
    recoveryTemplates: {
      "synthetic-alternate-assessment/v1": (tasks) => tasks.map((task) => task.key === "assessment" ? { ...task, key: "assessment-v2", tool: "synthetic.assessment/v1" } : {
        ...task,
        dependencies: task.dependencies.map((dependency) => dependency === "assessment" ? "assessment-v2" : dependency),
      }),
    },
  });
  return { tools, goals };
}
