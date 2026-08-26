import assert from "node:assert/strict";
import test from "node:test";
import { candidatePipelineReadiness, type CandidatePipelineEnvironment } from "./readiness.ts";

const base = { DB: {}, AGENT_RUNTIME_INTERNAL_TOKEN: "runtime", AGENT_RUNTIME_CONFIG_JSON: "{}", GOOGLE_OAUTH_CLIENT_ID: "client", GOOGLE_OAUTH_CLIENT_SECRET: "secret", GOOGLE_OAUTH_REDIRECT_URI: "https://app.example.test/api/integrations/google-drive/oauth/callback", GOOGLE_OAUTH_DEPLOYMENT_MODE: "production-personal", GOOGLE_OAUTH_TOKEN_KEYRING_JSON: "{}", LLM_RUNTIME_CONFIG_JSON: "{}", ROUTERAI_API_KEY: "router", ASSEMBLYAI_API_KEY: "assembly" };

test("production routing defaults to disabled and cannot start with partial bindings", () => {
  assert.equal(candidatePipelineReadiness(base).reason, "ROUTING_DISABLED");
  const partial = candidatePipelineReadiness({ CANDIDATE_PIPELINE_ROUTING: "shadow", DB: {} });
  assert.equal(partial.ready, false);
  assert.ok(partial.missing.includes("GOOGLE_OAUTH_CLIENT_ID"));
});

test("shadow requires runtime/Drive/RouterAI/AssemblyAI while effectful also requires verified release evidence", () => {
  assert.equal(candidatePipelineReadiness({ ...base, CANDIDATE_PIPELINE_ROUTING: "shadow" }).ready, true);
  assert.equal(candidatePipelineReadiness({ ...base, CANDIDATE_PIPELINE_ROUTING: "effectful" }).ready, false);
  const effectful = { ...base, CANDIDATE_PIPELINE_ROUTING: "effectful", TELEGRAM_BOT_TOKEN: "bot", TELEGRAM_RECIPIENT_REFS_JSON: "{}", CANDIDATE_PIPELINE_BUILD_ID: "build-1", CANDIDATE_PIPELINE_RELEASE_EVIDENCE_JSON: JSON.stringify({ buildId: "build-1", configurationFingerprint: "config-1", pairRecoveryGreen: true, outboxRecoveryGreen: true, hardBudgetsVerified: true }) };
  assert.equal(candidatePipelineReadiness(effectful).ready, true);
  assert.equal(candidatePipelineReadiness({ ...effectful, CANDIDATE_PIPELINE_BUILD_ID: "other-build" }).reason, "RELEASE_EVIDENCE_INVALID");
  assert.equal(candidatePipelineReadiness({ ...base, CANDIDATE_PIPELINE_ROUTING: "shadow", GOOGLE_SERVICE_ACCOUNT_JSON: "{}" } as CandidatePipelineEnvironment).reason, "GOOGLE_DRIVE_BACKEND_UNSUPPORTED");
});
