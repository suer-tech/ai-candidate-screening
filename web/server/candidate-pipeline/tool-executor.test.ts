import assert from "node:assert/strict";
import test from "node:test";
import { candidateToolErrorCode, executeCandidateTool, type ProductionRuntime } from "./tool-executor.ts";

test("controlled local tool outcome is derived from canonical stage evidence", async () => {
  const result = await executeCandidateTool({ mode: "controlled-local", environment: "local", toolKey: "candidate.transcription/v1", task: { id: "task-1" } });
  assert.equal(result.outcome, "SUCCEEDED");
  assert.equal(result.evidence?.productionLikeAcceptanceClaimed, false);
  assert.deepEqual(result.evidence?.stages, ["media-probe-and-audio", "assemblyai-transcription", "speaker-role-mapping"]);
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

const readyShadowEnvironment = {
  CANDIDATE_PIPELINE_ROUTING: "shadow",
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
    },
  };
}

const evidenceTask = { id: "task-evidence", idempotencyIdentity: "run:evidence", authorizationGrantId: "grant-evidence", inputVersion: "input-v1", profileVersion: "profile-v1" };

test("evidence post-processing identifies artifact registration failures without private diagnostics", async () => {
  const result = await executeCandidateTool({ mode: "production", environmentBindings: readyShadowEnvironment, runtime: evidenceRuntime("artifact"), toolKey: "candidate.evidence-extraction/v1", task: evidenceTask });
  assert.deepEqual(result, { outcome: "FAILED", errorCode: "FACT_EXTRACTION_ARTIFACT_REFERENCE_FAILED" });
});

test("evidence post-processing identifies checkpoint failures without private diagnostics", async () => {
  const result = await executeCandidateTool({ mode: "production", environmentBindings: readyShadowEnvironment, runtime: evidenceRuntime("checkpoint"), toolKey: "candidate.evidence-extraction/v1", task: evidenceTask });
  assert.deepEqual(result, { outcome: "FAILED", errorCode: "FACT_EXTRACTION_CHECKPOINT_FAILED" });
});
