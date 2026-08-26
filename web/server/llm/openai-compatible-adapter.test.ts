import assert from "node:assert/strict";
import test from "node:test";
import { LlmProviderAttemptError, type ProviderAttemptRequest } from "./gateway.ts";
import { OpenAiCompatibleProviderAdapter } from "./openai-compatible-adapter.ts";

const request: ProviderAttemptRequest = {
  endpoint: "https://router.invalid/v1",
  credential: "synthetic",
  model: "synthetic-model",
  apiContractVersion: "v1",
  messages: [],
  toolDefinitions: [],
  responseFormat: { type: "json_schema", json_schema: { name: "test", strict: true, schema: { type: "object", additionalProperties: false, required: [], properties: {} } } },
  generationParameters: {},
  limits: {},
  timeoutMs: 100,
};

test("HTTP 200 with malformed provider JSON is a retryable typed failure", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("{truncated", { status: 200, headers: { "content-type": "application/json" } });
  try {
    await assert.rejects(() => new OpenAiCompatibleProviderAdapter().execute(request), (error: unknown) => {
      assert.ok(error instanceof LlmProviderAttemptError);
      assert.equal(error.retryable, true);
      assert.deepEqual(error.traceError, { class: "invalid_provider_response" });
      return true;
    });
  } finally {
    globalThis.fetch = original;
  }
});

test("Node timeout errors are classified as retryable provider timeouts", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { const error = new Error("private timeout diagnostic"); error.name = "TimeoutError"; throw error; };
  try {
    await assert.rejects(() => new OpenAiCompatibleProviderAdapter().execute(request), (error: unknown) => {
      assert.ok(error instanceof LlmProviderAttemptError);
      assert.equal(error.retryable, true);
      assert.deepEqual(error.traceError, { class: "timeout" });
      return true;
    });
  } finally {
    globalThis.fetch = original;
  }
});

test("a timeout while reading an HTTP 200 response body remains a provider timeout", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => { const error = new Error("private body timeout diagnostic"); error.name = "AbortError"; throw error; },
  }) as Response;
  try {
    await assert.rejects(() => new OpenAiCompatibleProviderAdapter().execute(request), (error: unknown) => {
      assert.ok(error instanceof LlmProviderAttemptError);
      assert.equal(error.retryable, true);
      assert.equal(error.providerStatus, 200);
      assert.deepEqual(error.traceError, { class: "timeout" });
      return true;
    });
  } finally {
    globalThis.fetch = original;
  }
});
