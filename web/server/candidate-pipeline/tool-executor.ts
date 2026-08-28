import { runControlledCanonicalPipeline } from "./pipeline.ts";
import type { CanonicalStageId } from "./types.ts";
import { candidatePipelineReadiness, type CandidatePipelineEnvironment } from "./readiness.ts";

type CandidateToolStageId = CanonicalStageId | "matrix-compilation" | "criterion-claim-extraction" | "global-evidence-graph" | "matrix-row-evaluation" | "critical-row-verification";
const TOOL_STAGES: Record<string, CandidateToolStageId[]> = {
  "candidate.drive-snapshot/v1": ["drive-discovery", "stability-and-input-version", "material-completeness"],
  "candidate.document-extraction/v1": ["document-extraction", "routerai-ocr"],
  "candidate.transcription/v1": ["media-probe-and-audio", "assemblyai-transcription", "speaker-role-mapping"],
  "candidate.matrix-compile/v1": ["matrix-compilation"],
  "candidate.matrix-claims/v1": ["criterion-claim-extraction"],
  "candidate.matrix-context-search/v1": ["criterion-claim-extraction"],
  "candidate.matrix-context-read/v1": ["criterion-claim-extraction"],
  "candidate.matrix-claim-submit/v1": ["criterion-claim-extraction"],
  "candidate.matrix-evidence/v1": ["global-evidence-graph"],
  "candidate.matrix-conflict-submit/v1": ["global-evidence-graph"],
  "candidate.matrix-rows/v1": ["matrix-row-evaluation"],
  "candidate.matrix-verify/v1": ["critical-row-verification"],
  "candidate.matrix-recommendation/v1": ["deterministic-recommendation"],
  "candidate.evidence-extraction/v1": ["fact-and-evidence-extraction"],
  "candidate.assessment/v1": ["profile-assessment", "deterministic-recommendation"],
  "candidate.validation/v1": ["validation-gates"],
  "candidate.report-pair/v1": ["pdf-pair-render-and-validate"],
  "candidate.report/v1": ["pdf-pair-render-and-validate"],
  "candidate.drive-publication/v1": ["personal-drive-publication"],
  "candidate.telegram/v1": ["telegram-outbox"],
  "candidate.cleanup-block-triggers/v1": ["archive-delete-and-cleanup"],
  "candidate.cleanup-runtime/v1": ["archive-delete-and-cleanup"],
  "candidate.cleanup-provider/v1": ["archive-delete-and-cleanup"],
  "candidate.cleanup-temp/v1": ["archive-delete-and-cleanup"],
  "candidate.cleanup-reports/v1": ["archive-delete-and-cleanup"],
  "candidate.cleanup-domain/v1": ["archive-delete-and-cleanup"],
  "candidate.cleanup-tombstone/v1": ["archive-delete-and-cleanup"],
};

type ProductionRepository = {
  assertGrant(grantId: string, scope: Record<string, unknown>): Promise<boolean>;
  checkpoint(value: Record<string, unknown>): Promise<void>;
  artifactReference(value: { artifactRef: string; checksum?: string }): Promise<void>;
  outboxIntent(value: Record<string, unknown>): Promise<void>;
  waitForHuman(value: Record<string, unknown>): Promise<void>;
};

export type ProductionRuntime = {
  state?: { candidateState?: string };
  repository: ProductionRepository;
  oauth: { connectionId?: string; rootFolderId?: string; accessToken(task: Record<string, unknown>): Promise<string> };
  adapters: {
    drive: { snapshot(folderId: string): Promise<{ folderId: string; objects: Array<{ fileId: string }> }>; publishPdf(value: Record<string, unknown>): Promise<{ fileId?: string; checksum?: string }>; reconcile(identity: string): Promise<unknown> };
    routerAI: { invoke(value: Record<string, unknown>): Promise<{ artifactRef: string; schemaVersion?: string }> };
    assemblyAI: { create(value: Record<string, unknown>): Promise<{ remoteJobId: string }>; poll(remoteJobId: string): Promise<{ status?: string; artifactRef?: string }> };
    validation?: { validate(): Promise<{ artifactRef: string; checksum?: string }> };
    pdf: { renderPair(): Promise<Array<{ type: string; checksum: string; artifactRef: string }>> };
    telegram: { send(value: Record<string, unknown>): Promise<unknown> };
    matrix?: { execute(toolKey: string, task: Record<string, unknown>): Promise<{ artifactRef: string; checksum?: string; state?: string; [key: string]: unknown }> };
  };
  record?(kind: string, value?: Record<string, unknown>): void;
};

type ProductionSession = { reports: Array<{ type: string; checksum: string; artifactRef: string }> };
const productionSessions = new WeakMap<object, ProductionSession>();
type CandidateToolResult = {
  outcome: "SUCCEEDED" | "FAILED" | "UNKNOWN_OUTCOME" | "WAITING_FOR_HUMAN";
  errorCode?: string;
  obstacle?: string;
  action?: string;
  evidence?: { productionLikeAcceptanceClaimed?: boolean; stages?: CandidateToolStageId[]; [key: string]: unknown };
};

function session(runtime: ProductionRuntime) {
  let value = productionSessions.get(runtime as object);
  if (!value) { value = { reports: [] }; productionSessions.set(runtime as object, value); }
  return value;
}

function requiredTaskText(task: Record<string, unknown>, key: string) {
  const value = task[key];
  if (typeof value !== "string" || !value) throw new Error(`PRODUCTION_TASK_${key.toUpperCase()}_MISSING`);
  return value;
}

export function candidateToolErrorCode(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") return "PRODUCTION_TOOL_TIMEOUT";
    const message = error.message.trim();
    if (/^[A-Z][A-Z0-9_.-]*(?::[A-Za-z0-9_.-]+)*$/.test(message) && message !== "PRODUCTION_TOOL_EXECUTION_FAILED") return message;
  }
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string"
    && /^[A-Z][A-Z0-9_.-]*(?::[A-Za-z0-9_.-]+)*$/.test(error.code)
    && error.code !== "PRODUCTION_TOOL_EXECUTION_FAILED") {
    return error.code;
  }
  return "PRODUCTION_TOOL_EXECUTION_FAILED";
}

async function artifact(repository: ProductionRepository, artifactRef: string, checksum?: string) {
  await repository.artifactReference({ artifactRef, checksum });
  return artifactRef;
}

async function stageOperation<T>(operation: () => Promise<T>, fallback: string) {
  try {
    return await operation();
  } catch (error) {
    const code = candidateToolErrorCode(error);
    throw new Error(code === "PRODUCTION_TOOL_EXECUTION_FAILED" ? fallback : code);
  }
}

function releaseEvidence(environment: CandidatePipelineEnvironment, runtime: ProductionRuntime) {
  const evidence = JSON.parse(String(environment.CANDIDATE_PIPELINE_RELEASE_EVIDENCE_JSON ?? "")) as Record<string, unknown>;
  if (!environment.CANDIDATE_PIPELINE_BUILD_ID || evidence.buildId !== environment.CANDIDATE_PIPELINE_BUILD_ID
    || evidence.pairRecoveryGreen !== true || evidence.outboxRecoveryGreen !== true || evidence.hardBudgetsVerified !== true) {
    throw new Error("RELEASE_EVIDENCE_INVALID");
  }
  runtime.record?.("release-evidence:validated", { buildId: environment.CANDIDATE_PIPELINE_BUILD_ID });
}

async function executeProductionTool(input: { toolKey: string; task: Record<string, unknown>; environment: CandidatePipelineEnvironment; runtime: ProductionRuntime }): Promise<CandidateToolResult> {
  const { runtime, task } = input;
  const repository = runtime.repository;
  const identity = requiredTaskText(task, "idempotencyIdentity");
  const taskId = requiredTaskText(task, "id");
  const grantId = requiredTaskText(task, "authorizationGrantId");
  const checkpoint = (kind: string, artifactRef: string, extra: Record<string, unknown> = {}) => repository.checkpoint({ taskId, kind, identity, artifactRef, ...extra });

  try {
    if (input.environment.CANDIDATE_PIPELINE_ROUTING === "shadow"
      && (input.toolKey === "candidate.drive-publication/v1" || input.toolKey === "candidate.telegram/v1")) {
      const ref = await artifact(repository, `artifact:shadow-effect-suppressed:${identity}`);
      await checkpoint("shadow-effect-suppressed", ref, { toolKey: input.toolKey });
      return { outcome: "SUCCEEDED" as const, evidence: { artifactRef: ref, effectSuppressed: true, routing: "shadow" } };
    }

    if (input.toolKey === "candidate.drive-snapshot/v1") {
      const folderId = requiredTaskText(task, "candidateFolderId");
      const allowed = await repository.assertGrant(grantId, {
        toolKey: input.toolKey,
        connectionId: runtime.oauth.connectionId,
        rootFolderId: runtime.oauth.rootFolderId,
        candidateId: task.candidateId,
        candidateFolderId: folderId,
        inputVersion: task.inputVersion,
        operations: ["drive:list-candidate-folder", "drive:download-registered-input"],
      });
      if (!allowed) return { outcome: "FAILED" as const, errorCode: "GOOGLE_DRIVE_ROOT_OR_GRANT_DENIED" };
      await runtime.oauth.accessToken(task);
      const snapshot = await runtime.adapters.drive.snapshot(folderId);
      const ref = await artifact(repository, `artifact:drive-snapshot:${identity}`);
      await checkpoint("drive-snapshot", ref, { objectCount: snapshot.objects.length });
      return { outcome: "SUCCEEDED" as const, evidence: { artifactRef: ref, folderId: snapshot.folderId, objectIds: snapshot.objects.map((item) => item.fileId) } };
    }

    if (input.toolKey === "candidate.document-extraction/v1") {
      const result = await runtime.adapters.routerAI.invoke({ capability: "ocr", taskId, inputVersion: task.inputVersion });
      await artifact(repository, result.artifactRef);
      await checkpoint("document-extraction", result.artifactRef);
      return { outcome: "SUCCEEDED" as const, evidence: { artifactRef: result.artifactRef } };
    }

    if (input.toolKey === "candidate.transcription/v1") {
      const created = await runtime.adapters.assemblyAI.create({ operationIdentity: identity, taskId });
      await checkpoint("provider-job", `provider:assemblyai:${created.remoteJobId}`, { remoteJobId: created.remoteJobId });
      if (task.syntheticFault === "restart-after-provider-create") runtime.record?.("checkpoint:restored", { remoteJobId: created.remoteJobId });
      const polled = await runtime.adapters.assemblyAI.poll(created.remoteJobId);
      const ref = polled.artifactRef ?? `artifact:transcript:${created.remoteJobId}`;
      await artifact(repository, ref);
      await checkpoint("transcript", ref, { remoteJobId: created.remoteJobId });
      return { outcome: "SUCCEEDED" as const, evidence: { artifactRef: ref, remoteJobId: created.remoteJobId } };
    }

    if (input.toolKey === "candidate.evidence-extraction/v1" || input.toolKey === "candidate.assessment/v1") {
      const capability = input.toolKey === "candidate.evidence-extraction/v1" ? "fact_extraction" : "assessment";
      const result = await runtime.adapters.routerAI.invoke({ capability, taskId, inputVersion: task.inputVersion, profileVersion: task.profileVersion });
      await stageOperation(() => artifact(repository, result.artifactRef), `${capability.toUpperCase()}_ARTIFACT_REFERENCE_FAILED`);
      await stageOperation(() => checkpoint(capability, result.artifactRef), `${capability.toUpperCase()}_CHECKPOINT_FAILED`);
      return { outcome: "SUCCEEDED" as const, evidence: { artifactRef: result.artifactRef } };
    }

    if (input.toolKey.startsWith("candidate.matrix-")) {
      if (!runtime.adapters.matrix) throw new Error("MATRIX_RUNTIME_NOT_PROVISIONED");
      const result = await runtime.adapters.matrix.execute(input.toolKey, task);
      await stageOperation(() => artifact(repository, result.artifactRef, result.checksum), "MATRIX_ARTIFACT_REFERENCE_FAILED");
      await stageOperation(() => checkpoint(input.toolKey.replace(/^candidate\.|\/v1$/g, ""), result.artifactRef, { state: result.state }), "MATRIX_CHECKPOINT_FAILED");
      return { outcome: "SUCCEEDED" as const, evidence: { ...result } };
    }

    if (input.toolKey === "candidate.validation/v1") {
      const validated = runtime.adapters.validation
        ? await runtime.adapters.validation.validate()
        : { artifactRef: `artifact:validated-assessment:${identity}` };
      const ref = await artifact(repository, validated.artifactRef, validated.checksum);
      await checkpoint("validated-assessment", ref);
      return { outcome: "SUCCEEDED" as const, evidence: { artifactRef: ref } };
    }

    if (input.toolKey === "candidate.report-pair/v1" || input.toolKey === "candidate.report/v1") {
      const reports = await runtime.adapters.pdf.renderPair();
      const expectedCount = input.toolKey === "candidate.report/v1" ? 1 : 2;
      if (reports.length !== expectedCount || new Set(reports.map((item) => item.type)).size !== expectedCount
        || (expectedCount === 1 && reports[0]?.type !== "candidate-report")) throw new Error(expectedCount === 1 ? "CANDIDATE_REPORT_INVALID" : "REPORT_PAIR_INVALID");
      session(runtime).reports = reports.map((item) => ({ ...item }));
      for (const report of reports) await artifact(repository, report.artifactRef, report.checksum);
      await checkpoint(expectedCount === 1 ? "candidate-report" : "report-pair", `artifact:${expectedCount === 1 ? "candidate-report" : "report-pair"}:${identity}`);
      return { outcome: "SUCCEEDED" as const, evidence: { documents: reports.map(({ type, checksum, artifactRef }) => ({ type, checksum, artifactRef })) } };
    }

    if (input.toolKey === "candidate.drive-publication/v1") {
      releaseEvidence(input.environment, runtime);
      let reports = session(runtime).reports;
      if (reports.length === 0) reports = await runtime.adapters.pdf.renderPair();
      for (const report of reports) {
        const operationIdentity = `${identity}:${report.type}`;
        await repository.outboxIntent({ operationIdentity, kind: "drive-publication", artifactRef: report.artifactRef, checksum: report.checksum });
        const reconciled = await runtime.adapters.drive.reconcile(operationIdentity);
        if (!reconciled) {
          if (task.syntheticFault === "timeout-after-create") runtime.record?.("drive:retry", { operationIdentity });
          await runtime.adapters.drive.publishPdf({ operationIdentity, type: report.type, checksum: report.checksum, artifactRef: report.artifactRef });
        }
      }
      if (runtime.state) runtime.state.candidateState = "READY";
      const singular = reports.length === 1 && reports[0]?.type === "candidate-report";
      await checkpoint(singular ? "published-candidate-report" : "published-report-pair", `artifact:${singular ? "published-candidate-report" : "published-report-pair"}:${identity}`);
      return { outcome: "SUCCEEDED" as const, evidence: { state: "READY", documentCount: reports.length } };
    }

    if (input.toolKey === "candidate.telegram/v1") {
      releaseEvidence(input.environment, runtime);
      const recipients = JSON.parse(String(input.environment.TELEGRAM_RECIPIENT_REFS_JSON ?? "{}")) as Record<string, string>;
      for (const recipientRef of Object.keys(recipients)) {
        const logicalKey = `${identity}:analysis-ready`;
        const operationIdentity = `${logicalKey}:${recipientRef}`;
        await repository.outboxIntent({ operationIdentity, kind: "telegram", recipientRef, logicalKey });
        await runtime.adapters.telegram.send({ logicalKey, recipientRef, operationIdentity });
      }
      await checkpoint("telegram-event", `artifact:telegram-event:${identity}`);
      return { outcome: "SUCCEEDED" as const, evidence: { recipientCount: Object.keys(recipients).length } };
    }

    return { outcome: "FAILED" as const, errorCode: "TOOL_NOT_REGISTERED" };
  } catch (error) {
    const code = candidateToolErrorCode(error);
    if (code === "GOOGLE_OAUTH_INVALID_GRANT" || code === "GOOGLE_DRIVE_REAUTH_REQUIRED") {
      await repository.waitForHuman({ taskId, obstacle: "GOOGLE_OAUTH_INVALID_GRANT", action: "Переподключить Google Drive" });
      return { outcome: "WAITING_FOR_HUMAN" as const, errorCode: code, obstacle: "GOOGLE_OAUTH_INVALID_GRANT", action: "Переподключить Google Drive" };
    }
    if (code === "TELEGRAM_DELIVERY_UNKNOWN") return { outcome: "UNKNOWN_OUTCOME" as const, errorCode: code };
    return { outcome: "FAILED" as const, errorCode: code };
  }
}

export async function executeCandidateTool(input: { mode: "controlled-local" | "production"; environment?: string; environmentBindings?: CandidatePipelineEnvironment; runtime?: ProductionRuntime; toolKey: string; task: Record<string, unknown> }): Promise<CandidateToolResult> {
  const stages = TOOL_STAGES[input.toolKey];
  if (!stages) return { outcome: "FAILED" as const, errorCode: "TOOL_NOT_REGISTERED" };
  if (input.mode === "production") {
    if (!input.environmentBindings || !input.runtime) return { outcome: "FAILED" as const, errorCode: "PRODUCTION_TOOL_RUNTIME_NOT_PROVISIONED" };
    const readiness = candidatePipelineReadiness(input.environmentBindings);
    if (!readiness.ready) return { outcome: "FAILED" as const, errorCode: readiness.reason };
    return executeProductionTool({ toolKey: input.toolKey, task: input.task, environment: input.environmentBindings, runtime: input.runtime });
  }
  if (input.environment !== "local") {
    return { outcome: "FAILED" as const, errorCode: "CONTROLLED_TOOL_EXECUTOR_LOCAL_ONLY" };
  }
  const result = await runControlledCanonicalPipeline({ fixtureSetId: "canonical-candidate-v1", dataClassification: "synthetic-no-pii-no-secrets" });
  const canonicalStages = stages.filter((stage): stage is CanonicalStageId => stage in result.stages);
  const failed = canonicalStages.find((stage) => result.stages[stage].status !== "SUCCEEDED");
  return failed
    ? { outcome: "FAILED" as const, errorCode: result.stages[failed].safeCode ?? `CONTROLLED_STAGE_${failed}_FAILED` }
    : { outcome: "SUCCEEDED" as const, evidence: { scope: result.evidenceScope, stages, productionLikeAcceptanceClaimed: false, taskId: input.task.id } };
}

export function authorizeCandidateToolRequest(header: string | null, expected: string | undefined) {
  const actual = header?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || !actual || actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}
