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
  limits: { maxOutputTokens: 8192 },
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

test("passes the configured output-token limit to an OpenAI-compatible provider", async () => {
  const original = globalThis.fetch;
  let body: Record<string, unknown> = {};
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ id: "response-1", model: "synthetic-model", choices: [{ finish_reason: "stop", message: { content: "{}" } }] });
  };
  try {
    await new OpenAiCompatibleProviderAdapter().execute(request);
    assert.equal(body.max_tokens, 8192);
  } finally {
    globalThis.fetch = original;
  }
});

test("accepts one complete schema payload wrapped in markdown or provider commentary", async () => {
  const original = globalThis.fetch;
  for (const content of [
    "```json\n{\"schemaVersion\":\"vacancy-matrix-draft/v1\",\"criteria\":[]}\n```",
    "Готовый результат:\n{\"schemaVersion\":\"vacancy-matrix-draft/v1\",\"criteria\":[]}",
  ]) {
    globalThis.fetch = async () => Response.json({ id: "response-1", model: "synthetic-model", choices: [{ finish_reason: "stop", message: { content } }] });
    const result = await new OpenAiCompatibleProviderAdapter().execute(request);
    assert.deepEqual(result.normalizedOutput, { schemaVersion: "vacancy-matrix-draft/v1", criteria: [] });
  }
  globalThis.fetch = original;
});

test("does not accept an incomplete JSON payload", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: "{\"schemaVersion\":\"vacancy-matrix-draft/v1\"" } }] });
  try {
    await assert.rejects(() => new OpenAiCompatibleProviderAdapter().execute(request), (error: unknown) => {
      assert.ok(error instanceof LlmProviderAttemptError);
      assert.deepEqual(error.traceError, { class: "invalid_structured_output" });
      return true;
    });
  } finally {
    globalThis.fetch = original;
  }
});

test("does not mistake a complete nested object for a truncated top-level schema payload", async () => {
  const original = globalThis.fetch;
  const matrixRequest = { ...request, responseFormat: { type: "json_schema", json_schema: { name: "matrix", strict: true,
    schema: { type: "object", required: ["schemaVersion", "criteria"], properties: {} } } } } as ProviderAttemptRequest;
  globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: "{\"schemaVersion\":\"vacancy-matrix-draft/v1\",\"criteria\":[{\"temporaryId\":\"one\"}" } }] });
  try {
    await assert.rejects(() => new OpenAiCompatibleProviderAdapter().execute(matrixRequest), (error: unknown) => {
      assert.ok(error instanceof LlmProviderAttemptError);
      assert.deepEqual(error.traceError, { class: "invalid_structured_output" });
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
