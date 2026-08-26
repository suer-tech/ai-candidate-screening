import assert from "node:assert/strict";
import test from "node:test";
import { RESPONSE_SCHEMA_ARTIFACTS } from "../server/llm/artifacts.ts";
import { structuredResponseFormat, type ProviderAttemptRequest } from "../server/llm/gateway.ts";
import { OpenAiCompatibleProviderAdapter } from "../server/llm/openai-compatible-adapter.ts";
import type { JsonValue } from "../server/llm/value-utils.ts";

function record(value: unknown): Record<string, any> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, any>;
}

function inferredType(value: unknown): string | undefined {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return typeof value;
  if (typeof value === "number" && Number.isFinite(value)) return Number.isInteger(value) ? "integer" : "number";
  return undefined;
}

function verifyInferredTypes(value: unknown, path: string, failures: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const node = value as Record<string, unknown>;
  let expected: string | undefined;
  if (Object.hasOwn(node, "const")) expected = inferredType(node.const);
  if (!expected && Array.isArray(node.enum) && node.enum.length > 0) {
    const types = [...new Set(node.enum.map(inferredType))];
    if (types.length === 1) expected = types[0];
  }
  if (expected && node.type === undefined) failures.push(`${path}.type expected ${expected}; actual=undefined`);
  else if (expected && node.type !== expected) failures.push(`${path}.type expected ${expected}; actual=${JSON.stringify(node.type)}`);
  for (const [key, child] of Object.entries(node)) verifyInferredTypes(child, `${path}.${key}`, failures);
}

test("LLM-STRICT-SCHEMA-RED-001: transport recursively types homogeneous const/enum nodes without mutating artifacts", async () => {
  const artifact = RESPONSE_SCHEMA_ARTIFACTS["facts/v1"];
  const registryBefore = JSON.stringify(artifact);
  const responseFormat = structuredResponseFormat(artifact);
  let providerBody: Record<string, any> | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    providerBody = JSON.parse(String(init?.body)) as Record<string, any>;
    return new Response(JSON.stringify({
      id: "strict-schema-synthetic-request",
      model: "strict-schema-synthetic-model",
      choices: [{
        finish_reason: "stop",
        message: { role: "assistant", content: JSON.stringify({ schemaVersion: "facts/v1", facts: [], conflicts: [] }) },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const request: ProviderAttemptRequest = {
      endpoint: "https://router.invalid/v1/chat/completions",
      credential: "synthetic-not-a-secret",
      model: "strict-schema-synthetic-model",
      apiContractVersion: "openai-compatible/chat-completions/v1",
      messages: [{ role: "user", content: "Return synthetic facts." }],
      toolDefinitions: [],
      responseFormat,
      generationParameters: {},
      limits: {},
      timeoutMs: 1_000,
    };
    await new OpenAiCompatibleProviderAdapter().execute(request);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const failures: string[] = [];
  const transportedSchema = record(record(providerBody?.response_format).json_schema).schema;
  verifyInferredTypes(transportedSchema, "facts_v1", failures);

  const nestedFormat = structuredResponseFormat({
    id: "synthetic-nested-inference",
    version: "v1",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["state", "nested"],
      properties: {
        state: { enum: ["PASS", "REPAIR_REQUIRED"] },
        nested: {
          type: "object",
          additionalProperties: false,
          required: ["enabled"],
          properties: { enabled: { const: true } },
        },
      },
    } as JsonValue,
  });
  verifyInferredTypes(record(record(nestedFormat).json_schema).schema, "synthetic_nested", failures);

  if (JSON.stringify(artifact) !== registryBefore) failures.push("RESPONSE_SCHEMA_ARTIFACTS facts/v1 was mutated");
  if (!Object.isFrozen(artifact) || !Object.isFrozen(artifact.schema)) failures.push("registry artifact must remain deeply frozen");
  assert.deepEqual(failures, []);
});
