import assert from "node:assert/strict";
import test from "node:test";
import { candidateToolErrorCode, executeCandidateTool, type ProductionRuntime } from "./tool-executor.ts";

test("candidate tools fail closed when no runtime is provisioned", async () => {
  const result = await executeCandidateTool({ toolKey: "candidate.transcription/v1", task: { id: "task-1" } });
  assert.deepEqual(result, { outcome: "FAILED", errorCode: "PRODUCTION_TOOL_RUNTIME_NOT_PROVISIONED" });
});

test("production mode fails closed when its environment runtime is absent", async () => {
  assert.deepEqual(await executeCandidateTool({ mode: "production", environment: "staging", toolKey: "candidate.transcription/v1", task: {} }), { outcome: "FAILED", errorCode: "PRODUCTION_TOOL_RUNTIME_NOT_PROVISIONED" });
});

test("production failures expose stable codes instead of private diagnostics", () => {
  assert.equal(candidateToolErrorCode(new Error("provider returned a private diagnostic")), "PRODUCTION_TOOL_EXECUTION_FAILED");
  assert.equal(candidateToolErrorCode(new DOMException("operation timed out", "TimeoutError")), "PRODUCTION_TOOL_TIMEOUT");
  assert.equal(candidateToolErrorCode(new Error("GOOGLE_OAUTH_INVALID_GRANT")), "GOOGLE_OAUTH_INVALID_GRANT");
  assert.equal(candidateToolErrorCode(Object.assign(new Error("private diagnostic"), { code: "private diagnostic" })), "PRODUCTION_TOOL_EXECUTION_FAILED");
  assert.equal(candidateToolErrorCode(Object.assign(new Error("FACT_EXTRACTION_EXECUTION_FAILED"), { code: "PRODUCTION_TOOL_EXECUTION_FAILED" })), "FACT_EXTRACTION_EXECUTION_FAILED");
});

const readyIsolatedEnvironment = {
  CANDIDATE_PIPELINE_ROUTING: "effectful",
  AGENT_RUNTIME_INTERNAL_TOKEN: "synthetic",
  AGENT_RUNTIME_CONFIG_JSON: "{}",
  GOOGLE_OAUTH_CLIENT_ID: "synthetic",
  GOOGLE_OAUTH_CLIENT_SECRET: "synthetic",
  GOOGLE_OAUTH_REDIRECT_URI: "http://localhost/callback",
  GOOGLE_OAUTH_DEPLOYMENT_MODE: "production",
  GOOGLE_OAUTH_TOKEN_KEYRING_JSON: "{}",
  LLM_RUNTIME_CONFIG_JSON: "{}",
  ROUTERAI_API_KEY: "synthetic",
  ASSEMBLYAI_API_KEY: "synthetic",
  TELEGRAM_BOT_TOKEN: "synthetic",
  TELEGRAM_RECIPIENT_REFS_JSON: "{}",
};

function evidenceRuntime(failAt: "artifact" | "checkpoint"): ProductionRuntime {
  return {
    repository: {
      async assertGrant() { return true; },
      async checkpoint() { if (failAt === "checkpoint") throw new Error("private database diagnostic"); },
      async artifactReference() { if (failAt === "artifact") throw new Error("private database diagnostic"); },
      async outboxIntent() {},
      async waitForHuman() {},
    },
    oauth: { async accessToken() { return "synthetic"; } },
    adapters: {
      drive: { async snapshot(folderId) { return { folderId, objects: [] }; }, async publishPdf() { return {}; }, async reconcile() { return null; } },
      routerAI: { async invoke() { return { artifactRef: "artifact:evidence:synthetic" }; } },
      assemblyAI: { async create() { return { remoteJobId: "synthetic" }; }, async poll() { return {}; } },
      pdf: { async renderPair() { return []; } },
      telegram: { async send() {} },
      matrix: { async execute() { return { artifactRef: "artifact:evidence:synthetic" }; } },
    },
  };
}

const evidenceTask = { id: "task-evidence", idempotencyIdentity: "run:evidence", authorizationGrantId: "grant-evidence", inputVersion: "input-v1", profileVersion: "profile-v1" };

test("matrix post-processing identifies artifact registration failures without private diagnostics", async () => {
  const result = await executeCandidateTool({ environmentBindings: readyIsolatedEnvironment, runtime: evidenceRuntime("artifact"), toolKey: "candidate.matrix-claims/v1", task: evidenceTask });
  assert.deepEqual(result, { outcome: "FAILED", errorCode: "MATRIX_ARTIFACT_REFERENCE_FAILED" });
});

test("matrix post-processing identifies checkpoint failures without private diagnostics", async () => {
  const result = await executeCandidateTool({ environmentBindings: readyIsolatedEnvironment, runtime: evidenceRuntime("checkpoint"), toolKey: "candidate.matrix-claims/v1", task: evidenceTask });
  assert.deepEqual(result, { outcome: "FAILED", errorCode: "MATRIX_CHECKPOINT_FAILED" });
});
