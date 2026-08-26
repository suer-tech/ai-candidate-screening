import assert from "node:assert/strict";
import test from "node:test";
import { authorizePipelineEffect } from "./effect-policy.ts";

const base = { DB: {}, AGENT_RUNTIME_INTERNAL_TOKEN: "runtime", AGENT_RUNTIME_CONFIG_JSON: "{}", GOOGLE_OAUTH_CLIENT_ID: "client", GOOGLE_OAUTH_CLIENT_SECRET: "secret", GOOGLE_OAUTH_REDIRECT_URI: "https://app.example.test/api/integrations/google-drive/oauth/callback", GOOGLE_OAUTH_DEPLOYMENT_MODE: "production-personal", GOOGLE_OAUTH_TOKEN_KEYRING_JSON: "{}", LLM_RUNTIME_CONFIG_JSON: "{}", ROUTERAI_API_KEY: "router", ASSEMBLYAI_API_KEY: "assembly" };

test("shadow processes real inputs through validation but forbids visible PDF and Telegram effects", () => {
  const shadow = { ...base, CANDIDATE_PIPELINE_ROUTING: "shadow" };
  for (const effect of ["drive-read", "provider-processing", "artifact-write"] as const) assert.equal(authorizePipelineEffect(shadow, effect).allowed, true);
  assert.deepEqual(authorizePipelineEffect(shadow, "drive-publication"), { allowed: false, mode: "shadow", reason: "SHADOW_VISIBLE_EFFECT_DENIED" });
  assert.equal(authorizePipelineEffect(shadow, "telegram-delivery").allowed, false);
});

test("effectful routing is fail-closed until pair, outbox and hard budget evidence match the build", () => {
  const environment = { ...base, CANDIDATE_PIPELINE_ROUTING: "effectful", TELEGRAM_BOT_TOKEN: "bot", TELEGRAM_RECIPIENT_REFS_JSON: "{}", CANDIDATE_PIPELINE_BUILD_ID: "build-1", CANDIDATE_PIPELINE_RELEASE_EVIDENCE_JSON: JSON.stringify({ buildId: "build-1", configurationFingerprint: "config", pairRecoveryGreen: true, outboxRecoveryGreen: true, hardBudgetsVerified: true }) };
  assert.equal(authorizePipelineEffect(environment, "drive-publication").allowed, true);
  assert.equal(authorizePipelineEffect({ ...environment, CANDIDATE_PIPELINE_RELEASE_EVIDENCE_JSON: JSON.stringify({ buildId: "build-1", pairRecoveryGreen: true }) }, "telegram-delivery").allowed, false);
});
