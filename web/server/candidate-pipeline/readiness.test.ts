import assert from "node:assert/strict";
import test from "node:test";
import { candidatePipelineReadiness, type CandidatePipelineEnvironment } from "./readiness.ts";

const base = { DB: {}, AGENT_RUNTIME_INTERNAL_TOKEN: "runtime", AGENT_RUNTIME_CONFIG_JSON: "{}", GOOGLE_OAUTH_CLIENT_ID: "client", GOOGLE_OAUTH_CLIENT_SECRET: "secret", GOOGLE_OAUTH_REDIRECT_URI: "https://app.example.test/api/integrations/google-drive/oauth/callback", GOOGLE_OAUTH_DEPLOYMENT_MODE: "production-personal", GOOGLE_OAUTH_TOKEN_KEYRING_JSON: "{}", LLM_RUNTIME_CONFIG_JSON: "{}", ROUTERAI_API_KEY: "router", ASSEMBLYAI_API_KEY: "assembly" };

test("production routing defaults to disabled and rejects unsupported routing modes", () => {
  assert.equal(candidatePipelineReadiness(base).reason, "ROUTING_DISABLED");
  const partial = candidatePipelineReadiness({ CANDIDATE_PIPELINE_ROUTING: "shadow", DB: {} });
  assert.equal(partial.ready, false);
  assert.equal(partial.reason, "INVALID_ROUTING_MODE");
});

test("effectful routing requires runtime providers but not an obsolete runtime release-evidence file", () => {
  assert.equal(candidatePipelineReadiness({ ...base, CANDIDATE_PIPELINE_ROUTING: "effectful" }).ready, false);
  const effectful = { ...base, CANDIDATE_PIPELINE_ROUTING: "effectful", TELEGRAM_BOT_TOKEN: "bot", TELEGRAM_RECIPIENT_REFS_JSON: "{}", CANDIDATE_PIPELINE_BUILD_ID: "build-1" };
  assert.equal(candidatePipelineReadiness(effectful).ready, true);
  assert.equal(candidatePipelineReadiness({ ...effectful, GOOGLE_SERVICE_ACCOUNT_JSON: "{}" } as CandidatePipelineEnvironment).reason, "GOOGLE_DRIVE_BACKEND_UNSUPPORTED");
});
