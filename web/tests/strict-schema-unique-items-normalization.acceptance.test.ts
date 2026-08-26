import assert from "node:assert/strict";
import test from "node:test";
import { RESPONSE_SCHEMA_ARTIFACTS } from "../server/llm/artifacts.ts";
import { structuredResponseFormat, type ProviderAttemptRequest } from "../server/llm/gateway.ts";
import { OpenAiCompatibleProviderAdapter } from "../server/llm/openai-compatible-adapter.ts";

function record(value: unknown): Record<string, any> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, any>;
}

function keywordPaths(value: unknown, keyword: string, path = "$", paths: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((child, index) => keywordPaths(child, keyword, `${path}[${index}]`, paths));
    return paths;
  }
  if (!value || typeof value !== "object") return paths;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (key === keyword) paths.push(childPath);
    keywordPaths(child, keyword, childPath, paths);
  }
  return paths;
}

test("LLM-STRICT-SCHEMA-RED-002: transport recursively removes uniqueItems without mutating the matrix artifact", async () => {
  const artifact = RESPONSE_SCHEMA_ARTIFACTS["vacancy-matrix-draft/v1"];
  const registryBefore = JSON.stringify(artifact);
  const sourceKeywordPaths = keywordPaths(artifact.schema, "uniqueItems");
  assert.ok(
    sourceKeywordPaths.some((path) => path.includes("sourceRefs")),
    `fixture precondition: vacancy matrix sourceRefs must declare uniqueItems; actual=${JSON.stringify(sourceKeywordPaths)}`,
  );

  const responseFormat = structuredResponseFormat(artifact);
  let providerBody: Record<string, any> | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    providerBody = JSON.parse(String(init?.body)) as Record<string, any>;
    return new Response(JSON.stringify({
      id: "strict-schema-unique-items-request",
      model: "strict-schema-synthetic-model",
      choices: [{
        finish_reason: "stop",
        message: {
          role: "assistant",
          content: JSON.stringify({ schemaVersion: "vacancy-matrix-draft/v1", criteria: [] }),
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const request: ProviderAttemptRequest = {
      endpoint: "https://router.invalid/v1/chat/completions",
      credential: "synthetic-not-a-secret",
      model: "strict-schema-synthetic-model",
      apiContractVersion: "openai-compatible/chat-completions/v1",
      messages: [{ role: "user", content: "Return a synthetic vacancy matrix." }],
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
  const transportedKeywordPaths = keywordPaths(transportedSchema, "uniqueItems");
  if (transportedKeywordPaths.length > 0) {
    failures.push(`transported strict schema still contains unsupported uniqueItems at ${transportedKeywordPaths.join(", ")}`);
  }
  if (JSON.stringify(artifact) !== registryBefore) failures.push("RESPONSE_SCHEMA_ARTIFACTS vacancy-matrix-draft/v1 was mutated");
  if (!Object.isFrozen(artifact) || !Object.isFrozen(artifact.schema)) failures.push("registry artifact must remain deeply frozen");
  if (!keywordPaths(artifact.schema, "uniqueItems").some((path) => path.includes("sourceRefs"))) {
    failures.push("registry sourceRefs.uniqueItems must remain intact after transport normalization");
  }
  assert.deepEqual(failures, []);
});
