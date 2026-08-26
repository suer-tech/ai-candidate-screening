import type { PlanTaskTemplate, ToolDefinition } from "../agent-runtime/types.ts";
import { GoalRegistry, ToolRegistry } from "../agent-runtime/registry.ts";

const tasks: readonly PlanTaskTemplate[] = [
  { key: "drive-snapshot", tool: "candidate.drive-snapshot/v1", dependencies: [], expectedOutputs: ["input-version"] },
  { key: "documents", tool: "candidate.document-extraction/v1", dependencies: ["drive-snapshot"], expectedOutputs: ["document-artifacts"] },
  { key: "transcription", tool: "candidate.transcription/v1", dependencies: ["drive-snapshot"], expectedOutputs: ["transcript-artifacts"] },
  { key: "evidence", tool: "candidate.evidence-extraction/v1", dependencies: ["documents", "transcription"], expectedOutputs: ["evidence-graph"] },
  { key: "assessment", tool: "candidate.assessment/v1", dependencies: ["evidence"], expectedOutputs: ["assessment-snapshot"] },
  { key: "validation", tool: "candidate.validation/v1", dependencies: ["assessment"], expectedOutputs: ["validated-assessment"] },
  { key: "reports", tool: "candidate.report-pair/v1", dependencies: ["validation"], expectedOutputs: ["abc-pdf", "result-pdf"], completionGate: "validated-report-pair" },
  { key: "publication", tool: "candidate.drive-publication/v1", dependencies: ["reports"], expectedOutputs: ["published-report-pair"], completionGate: "ready-after-pair-publication" },
  { key: "notification", tool: "candidate.telegram/v1", dependencies: ["publication"], expectedOutputs: ["delivery-outcome"], completionGate: "logical-notification-created" },
];

const matrixTasks: readonly PlanTaskTemplate[] = [
  { key: "drive-snapshot", tool: "candidate.drive-snapshot/v1", dependencies: [], expectedOutputs: ["input-version"] },
  { key: "matrix", tool: "candidate.matrix-compile/v1", dependencies: [], expectedOutputs: ["vacancy-matrix"] },
  { key: "documents", tool: "candidate.document-extraction/v1", dependencies: ["drive-snapshot"], expectedOutputs: ["document-artifacts"] },
  { key: "transcription", tool: "candidate.transcription/v1", dependencies: ["drive-snapshot"], expectedOutputs: ["transcript-artifacts"] },
  { key: "context-search", tool: "candidate.matrix-context-search/v1", dependencies: ["documents", "transcription"], expectedOutputs: ["candidate-context-index"] },
  { key: "context-read", tool: "candidate.matrix-context-read/v1", dependencies: ["context-search"], expectedOutputs: ["decision-safe-full-context"] },
  { key: "claims", tool: "candidate.matrix-claim-submit/v1", dependencies: ["matrix", "context-read"], expectedOutputs: ["candidate-source-claims"] },
  { key: "global-evidence", tool: "candidate.matrix-conflict-submit/v1", dependencies: ["claims"], expectedOutputs: ["global-evidence-graph"] },
  { key: "rows", tool: "candidate.matrix-rows/v1", dependencies: ["matrix", "global-evidence"], expectedOutputs: ["candidate-matrix-rows"] },
  { key: "critical-verification", tool: "candidate.matrix-verify/v1", dependencies: ["rows"], expectedOutputs: ["verified-critical-rows"] },
  { key: "recommendation", tool: "candidate.matrix-recommendation/v1", dependencies: ["critical-verification"], expectedOutputs: ["assessment-snapshot", "deterministic-recommendation"] },
  { key: "validation", tool: "candidate.validation/v1", dependencies: ["recommendation"], expectedOutputs: ["validated-assessment"] },
  { key: "reports", tool: "candidate.report-pair/v1", dependencies: ["validation"], expectedOutputs: ["abc-pdf", "result-pdf"], completionGate: "validated-report-pair" },
  { key: "publication", tool: "candidate.drive-publication/v1", dependencies: ["reports"], expectedOutputs: ["published-report-pair"], completionGate: "ready-after-pair-publication" },
  { key: "notification", tool: "candidate.telegram/v1", dependencies: ["publication"], expectedOutputs: ["delivery-outcome"], completionGate: "logical-notification-created" },
];
const matrixShadowTasks = matrixTasks
  .filter((task) => !["reports", "publication", "notification"].includes(task.key))
  .map((task) => task.key === "validation" ? { ...task, completionGate: "validated-assessment" } : task);

function tool(key: string, sideEffectClass: ToolDefinition["sideEffectClass"], checkpoint: ToolDefinition["checkpoint"], requiredSecrets: string[] = []): ToolDefinition {
  return { key, version: "1", inputSchemaVersion: "1.0", outputSchemaVersion: "1.0", timeoutClass: "short-external", retryClass: "transient", sideEffectClass, idempotency: sideEffectClass === "read-only" ? "none" : "identity", checkpoint, requiredSecrets, recoveryActions: ["reconcile"] };
}

export function registerCanonicalCandidatePipeline(tools: ToolRegistry, goals: GoalRegistry) {
  for (const definition of [
    tool("candidate.drive-snapshot/v1", "read-only", "artifact", ["GOOGLE_DRIVE_OAUTH_CONNECTION"]),
    tool("candidate.document-extraction/v1", "idempotent-write", "artifact"),
    tool("candidate.transcription/v1", "idempotent-write", "remote-job", ["ASSEMBLYAI_API_KEY"]),
    tool("candidate.evidence-extraction/v1", "idempotent-write", "artifact", ["ROUTERAI_API_KEY"]),
    tool("candidate.assessment/v1", "idempotent-write", "artifact", ["ROUTERAI_API_KEY"]),
    tool("candidate.matrix-compile/v1", "idempotent-write", "artifact", ["ROUTERAI_API_KEY"]),
    tool("candidate.matrix-claims/v1", "idempotent-write", "artifact", ["ROUTERAI_API_KEY"]),
    tool("candidate.matrix-evidence/v1", "idempotent-write", "artifact", ["ROUTERAI_API_KEY"]),
    tool("candidate.matrix-rows/v1", "idempotent-write", "artifact", ["ROUTERAI_API_KEY"]),
    tool("candidate.matrix-verify/v1", "idempotent-write", "artifact", ["ROUTERAI_API_KEY"]),
    tool("candidate.matrix-recommendation/v1", "idempotent-write", "artifact"),
    tool("candidate.matrix-profile-read/v1", "read-only", "artifact"),
    tool("candidate.matrix-source-read/v1", "read-only", "artifact"),
    tool("candidate.matrix-draft-submit/v1", "idempotent-write", "artifact"),
    tool("candidate.matrix-schema-validate/v1", "read-only", "artifact"),
    tool("candidate.matrix-critic-result/v1", "idempotent-write", "artifact"),
    tool("candidate.matrix-repair-policy/v1", "read-only", "artifact"),
    tool("candidate.matrix-interpretation-notes/v1", "idempotent-write", "artifact"),
    tool("candidate.matrix-persist/v1", "idempotent-write", "artifact"),
    tool("candidate.matrix-context-search/v1", "read-only", "artifact"),
    tool("candidate.matrix-context-read/v1", "read-only", "artifact"),
    tool("candidate.matrix-claim-submit/v1", "idempotent-write", "artifact"),
    tool("candidate.matrix-conflict-submit/v1", "idempotent-write", "artifact"),
    tool("candidate.validation/v1", "read-only", "artifact"),
    { ...tool("candidate.report-pair/v1", "idempotent-write", "artifact"), compensation: "candidate.report-delete/v1" },
    { ...tool("candidate.drive-publication/v1", "reversible-write", "artifact", ["GOOGLE_DRIVE_OAUTH_CONNECTION"]), compensation: "candidate.drive-publication-delete/v1" },
    tool("candidate.telegram/v1", "irreversible-write", "artifact", ["TELEGRAM_BOT_TOKEN", "TELEGRAM_RECIPIENT_REFS"]),
    tool("candidate.cleanup-block-triggers/v1", "idempotent-write", "artifact"),
    tool("candidate.cleanup-runtime/v1", "reversible-write", "artifact"),
    tool("candidate.cleanup-provider/v1", "reversible-write", "remote-job", ["ASSEMBLYAI_API_KEY"]),
    tool("candidate.cleanup-temp/v1", "reversible-write", "artifact"),
    tool("candidate.cleanup-reports/v1", "reversible-write", "artifact", ["GOOGLE_DRIVE_OAUTH_CONNECTION"]),
    tool("candidate.cleanup-domain/v1", "reversible-write", "artifact"),
    tool("candidate.cleanup-tombstone/v1", "idempotent-write", "artifact"),
  ]) tools.register(definition);

  goals.register({
    key: "candidate-analysis/v1",
    policyVersions: ["candidate-policy-v1"],
    completionCriteriaVersions: ["candidate-completion-v1"],
    plan: () => tasks.map((task) => structuredClone(task)),
    recoveryTemplates: {
      "candidate-bounded-repair/v1": (current) => current.map((task) => task.key === "assessment" ? { ...task, key: "assessment-repair", dependencies: ["evidence"] } : { ...task, dependencies: task.dependencies.map((item) => item === "assessment" ? "assessment-repair" : item) }),
    },
  });
  goals.register({
    key: "candidate-analysis-matrix/v1",
    policyVersions: ["candidate-policy-v1"],
    completionCriteriaVersions: ["candidate-completion-v1"],
    plan: () => matrixTasks.map((task) => structuredClone(task)),
    recoveryTemplates: {
      "candidate-bounded-repair/v1": (current) => current.map((task) => task.key === "rows" ? { ...task, key: "rows-repair", dependencies: ["matrix", "global-evidence"] } : { ...task, dependencies: task.dependencies.map((item) => item === "rows" ? "rows-repair" : item) }),
    },
  });
  goals.register({
    key: "candidate-analysis-matrix-shadow/v1",
    policyVersions: ["candidate-policy-v1"],
    completionCriteriaVersions: ["candidate-completion-v1"],
    plan: () => matrixShadowTasks.map((task) => structuredClone(task)),
    recoveryTemplates: {
      "candidate-bounded-repair/v1": (current) => current.map((task) => task.key === "rows" ? { ...task, key: "rows-repair", dependencies: ["matrix", "global-evidence"] } : { ...task, dependencies: task.dependencies.map((item) => item === "rows" ? "rows-repair" : item) }),
    },
  });
  goals.register({
    key: "candidate-cleanup/v1",
    policyVersions: ["candidate-policy-v1"],
    completionCriteriaVersions: ["candidate-cleanup-completion-v1"],
    plan: () => [
      { key: "block-triggers", tool: "candidate.cleanup-block-triggers/v1", dependencies: [], expectedOutputs: ["triggers-blocked"] },
      { key: "runtime", tool: "candidate.cleanup-runtime/v1", dependencies: ["block-triggers"], expectedOutputs: ["grants-revoked", "tasks-cancelled"] },
      { key: "provider", tool: "candidate.cleanup-provider/v1", dependencies: ["block-triggers"], expectedOutputs: ["provider-artifacts-removed"] },
      { key: "temp", tool: "candidate.cleanup-temp/v1", dependencies: ["block-triggers"], expectedOutputs: ["temp-artifacts-removed"] },
      { key: "reports", tool: "candidate.cleanup-reports/v1", dependencies: ["block-triggers"], expectedOutputs: ["report-artifacts-removed"] },
      { key: "domain", tool: "candidate.cleanup-domain/v1", dependencies: ["runtime", "provider", "temp", "reports"], expectedOutputs: ["domain-artifacts-removed"] },
      { key: "tombstone", tool: "candidate.cleanup-tombstone/v1", dependencies: ["domain"], expectedOutputs: ["drive-folder-tombstone"], completionGate: "all-cleanup-confirmations-persisted" },
    ],
    recoveryTemplates: {},
  });
}
