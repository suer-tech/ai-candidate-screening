import assert from "node:assert/strict";
import test from "node:test";
import { handleExternalE2eControl } from "./e2e-control.ts";

const environment = { E2E_CONTROL_TOKEN: "caller-token", E2E_FIXTURE_CONTROL_URL: "https://fixture.example.com/control/", E2E_FIXTURE_CONTROL_TOKEN: "service-token", E2E_ENVIRONMENT: "staging", E2E_ALLOW_DESTRUCTIVE_CLEANUP: "true", CANDIDATE_PIPELINE_BUILD_ID: "build-1" };

test("external control API authenticates, allowlists and replaces caller credentials", async () => {
  let forwardedAuthorization = "";
  const response = await handleExternalE2eControl(new Request("https://app.example.com/api/e2e-control/runs", { method: "POST", headers: { authorization: "Bearer caller-token", "content-type": "application/json" }, body: JSON.stringify({ uniquePrefix: "e2e-1" }) }), "/runs", environment, async (input, init) => {
    assert.equal(String(input), "https://fixture.example.com/runs");
    forwardedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
    assert.equal(new Headers(init?.headers).get("x-e2e-build-id"), "build-1");
    return Response.json({ runId: "run-1", dataClassification: "synthetic-no-pii-no-secrets" }, { status: 201 });
  });
  assert.equal(response.status, 201);
  assert.equal(forwardedAuthorization, "Bearer service-token");
  assert.equal(forwardedAuthorization.includes("caller-token"), false);
  assert.equal((await handleExternalE2eControl(new Request("https://app.example.com", { method: "POST" }), "/runs", environment)).status, 401);
  assert.equal((await handleExternalE2eControl(new Request("https://app.example.com", { method: "DELETE", headers: { authorization: "Bearer caller-token" } }), "/runs/run-1", environment)).status, 404);
});

test("control API is disabled outside isolated destructive environments", async () => {
  const response = await handleExternalE2eControl(new Request("https://app.example.com", { method: "POST", headers: { authorization: "Bearer caller-token" } }), "/preflight", { ...environment, E2E_ENVIRONMENT: "production" });
  assert.equal(response.status, 403);
});

test("unsafe fixture-controller evidence is rejected instead of leaking", async () => {
  const request = new Request("https://app.example.com", { headers: { authorization: "Bearer caller-token" } });
  const unsafeKey = await handleExternalE2eControl(request, "/runs/run-1/evidence/result", environment, async () => Response.json({ chat_id: "123" }));
  assert.equal(unsafeKey.status, 503);
  const unsafeValue = await handleExternalE2eControl(request, "/runs/run-1/evidence/result", environment, async () => Response.json({ evidence: "Bearer exposed-secret" }));
  assert.equal(unsafeValue.status, 503);
});

test("cleanup is an explicit allowlisted operation and retains upstream attestation", async () => {
  const response = await handleExternalE2eControl(new Request("https://app.example.com", { method: "POST", headers: { authorization: "Bearer caller-token" } }), "/runs/run-1/cleanup", environment, async () => Response.json({ complete: true, sourceDriveFolderAbsent: true, minimalTombstoneContainsPersonalData: false }));
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { complete: boolean }).complete, true);
});
