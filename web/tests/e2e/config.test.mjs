import assert from "node:assert/strict";
import test from "node:test";
import { readE2eConfig } from "./config.mjs";

const complete = {
  E2E_BASE_URL: "https://candidate-staging.example.com",
  E2E_AUTH_STORAGE_STATE: "C:/secure/hr-state.json",
  E2E_PREFLIGHT_TOKEN: "preflight-secret",
  E2E_CONTROL_URL: "https://candidate-control.example.com",
  E2E_CONTROL_TOKEN: "control-secret",
  E2E_FIXTURE_SET_ID: "synthetic-candidate-v1",
  E2E_BUILD_ID: "build-123",
  E2E_ENVIRONMENT: "staging",
  E2E_ALLOW_DESTRUCTIVE_CLEANUP: "true",
};

test("E2E config accepts only a complete production-like destructive-test boundary", () => {
  const config = readE2eConfig(complete, { fileExists: () => true });
  assert.equal(config.environment, "staging");
  assert.equal(config.fixtureSetId, "synthetic-candidate-v1");
});

test("E2E config fails fast with the full missing-variable list", () => {
  assert.throws(() => readE2eConfig({}, { fileExists: () => false }), /E2E_BASE_URL[^]*E2E_ALLOW_DESTRUCTIVE_CLEANUP/);
});

test("E2E config rejects local, mock and production cleanup targets", () => {
  assert.throws(() => readE2eConfig({ ...complete, E2E_BASE_URL: "http://localhost:3000" }, { fileExists: () => true }), /HTTPS/);
  assert.throws(() => readE2eConfig({ ...complete, E2E_CONTROL_URL: "https://mock-control.example.com" }, { fileExists: () => true }), /demo or mock/);
  assert.throws(() => readE2eConfig({ ...complete, E2E_ENVIRONMENT: "production" }, { fileExists: () => true }), /not a destructive test target/);
});
