import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { OpenAiCompatibleProviderAdapter } from "../server/llm/openai-compatible-adapter.ts";
import type { ProviderAttemptRequest } from "../server/llm/gateway.ts";
import type { JsonValue } from "../server/llm/value-utils.ts";

function providerRequest(messages: JsonValue[]): ProviderAttemptRequest {
  return {
    endpoint: "https://router.invalid/v1/chat/completions",
    credential: "synthetic-not-a-secret",
    model: "synthetic-model",
    apiContractVersion: "openai-compatible/chat-completions/v1",
    messages,
    toolDefinitions: [],
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "synthetic_result",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["schemaVersion"],
          properties: { schemaVersion: { type: "string", const: "synthetic/v1" } },
        },
      },
    },
    generationParameters: {},
    limits: {},
    timeoutMs: 1_000,
  };
}

async function captureProviderMessages(messages: JsonValue[]) {
  const originalFetch = globalThis.fetch;
  let body: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      id: "synthetic-provider-request",
      model: "synthetic-model",
      choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ schemaVersion: "synthetic/v1" }) } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    await new OpenAiCompatibleProviderAdapter().execute(providerRequest(messages));
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.ok(body);
  return body.messages as Array<Record<string, unknown>>;
}

test("LLM-TRANSPORT-RED-001: object-valued message content is JSON-stringified before OpenAI-compatible fetch", async () => {
  const objectContent = {
    candidateId: "candidate-synthetic-transport",
    evidence: { criterionIds: ["criterion-1"], locatorIds: ["locator-synthetic-1"] },
  };
  const messages = await captureProviderMessages([{ role: "user", content: objectContent }]);
  assert.equal(messages[0].role, "user");
  assert.equal(messages[0].content, JSON.stringify(objectContent));
});

test("LLM-TRANSPORT-002: string-valued message content reaches OpenAI-compatible fetch unchanged", async () => {
  const stringContent = "synthetic plain prompt\nwith preserved newline";
  const messages = await captureProviderMessages([{ role: "system", content: stringContent }]);
  assert.equal(messages[0].content, stringContent);
});

test("LLM-TRANSPORT-003: array-valued message content reaches OpenAI-compatible fetch unchanged", async () => {
  const arrayContent = [
    { type: "text", text: "synthetic content block" },
    { type: "input_text", text: "second synthetic block" },
  ];
  const messages = await captureProviderMessages([{ role: "user", content: arrayContent }]);
  assert.deepEqual(messages[0].content, arrayContent);
});

test("MATRIX-ROUTING-004: production discovery pins matrix-v3 as the primary run", async () => {
  const source = await readFile(new URL("../server/candidate-pipeline/production-discovery.ts", import.meta.url), "utf8");
  assert.match(source, /MATRIX_ASSESSMENT_ROUTING\s*===\s*["']production["']\s*\?\s*["']candidate-analysis-matrix\/v1["']\s*:\s*["']candidate-analysis\/v1["']/);
  assert.match(source, /MATRIX_ASSESSMENT_ROUTING\s*===\s*["']production["']\s*\?\s*["']matrix-v3["']\s*:\s*["']legacy-v1["']/);
  assert.match(source, /runtime\.createGoal\(\{[\s\S]*?goalType:[\s\S]*?workflowVersion:[\s\S]*?triggerIdentity[\s\S]*?\}\)/);
});

test("MATRIX-ROUTING-005: shadow discovery keeps legacy primary and creates a matrix-v3-shadow run", async () => {
  const source = await readFile(new URL("../server/candidate-pipeline/production-discovery.ts", import.meta.url), "utf8");
  assert.match(source, /MATRIX_ASSESSMENT_ROUTING\s*===\s*["']shadow["']\)\s*await\s+runtime\.createGoal\(\{/);
  assert.match(source, /goalType:\s*["']candidate-analysis-matrix-shadow\/v1["'][\s\S]*?workflowVersion:\s*["']matrix-v3-shadow["']/);
  assert.match(source, /completionCriteria:\s*\[["']validated-assessment["']\]/);
  assert.match(source, /triggerIdentity:\s*`\$\{triggerIdentity\}:matrix-shadow`/);
});
