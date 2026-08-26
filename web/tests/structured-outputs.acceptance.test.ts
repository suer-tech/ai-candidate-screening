import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { RESPONSE_SCHEMA_ARTIFACTS } from "../server/llm/artifacts.ts";
import { validateRuntimeConfiguration } from "../server/llm/configuration.ts";
import { executeLlmAttempt, LlmProviderAttemptError, type ProviderAttemptRequest } from "../server/llm/gateway.ts";
import { OpenAiCompatibleProviderAdapter } from "../server/llm/openai-compatible-adapter.ts";
import { AdminOnlyProtectedTraceStore, InMemoryProtectedTracePersistence } from "../server/llm/protected-store.ts";

const credential = "synthetic-structured-output-secret";
const secrets = {
  has: (reference: string) => reference === "provider/acceptance",
  read: (reference: string) => reference === "provider/acceptance" ? credential : undefined,
};

function configuration(responseSchemaArtifact = "facts/v1", supportsStructuredOutputs: boolean | "missing" = true) {
  const provider: Record<string, unknown> = {
    provider: "controlled-openai-compatible",
    endpoint: "https://provider.example.test/v1/chat/completions",
    secretReference: "provider/acceptance",
    apiContractVersion: "openai-compatible/chat-completions/v1",
  };
  if (supportsStructuredOutputs !== "missing") provider.supportsStructuredOutputs = supportsStructuredOutputs;
  return {
    releaseVersion: "structured-outputs-acceptance-v1",
    providers: { controlled: provider },
    capabilities: {
      fact_extraction: {
        providerProfile: "controlled",
        model: "controlled-structured-model",
        promptArtifact: "fact-extraction/v1",
        responseSchemaArtifact,
        toolSchemaArtifacts: ["no-tools/v1"],
        generationParameters: { temperature: 0 },
        limits: { maxOutputTokens: 1_000 },
        timeoutMs: 5_000,
        retryPolicy: { maxAttempts: 1, initialBackoffMs: 0, maximumBackoffMs: 0 },
        fallbackPolicy: { mode: "disabled" },
      },
    },
  };
}

function providerAttempt(overrides: Partial<ProviderAttemptRequest> = {}): ProviderAttemptRequest {
  return {
    endpoint: "https://provider.example.test/v1/chat/completions",
    credential,
    model: "controlled-structured-model",
    apiContractVersion: "openai-compatible/chat-completions/v1",
    messages: [{ role: "user", content: "Return the structured fact result." }],
    toolDefinitions: [],
    generationParameters: { temperature: 0 },
    limits: { maxOutputTokens: 1_000 },
    timeoutMs: 5_000,
    responseFormat: {
      type: "json_schema",
      json_schema: { name: "facts_v1", strict: true, schema: RESPONSE_SCHEMA_ARTIFACTS["facts/v1"].schema },
    },
    ...overrides,
  } as unknown as ProviderAttemptRequest;
}

function asRecord(value: unknown): Record<string, any> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, any>;
}

function assertStrictObjectTree(value: unknown, path = "schema") {
  const node = asRecord(value);
  const types = Array.isArray(node.type) ? node.type : [node.type];
  if (types.includes("object") || node.properties) {
    assert.equal(node.additionalProperties, false, `${path}: object is closed`);
    const properties = asRecord(node.properties);
    assert.deepEqual(new Set(node.required), new Set(Object.keys(properties)), `${path}: every property is required in strict mode`);
    for (const [key, child] of Object.entries(properties)) assertStrictObjectTree(child, `${path}.properties.${key}`);
  }
  if (types.includes("array") || node.items) {
    assert.ok(node.items && typeof node.items === "object", `${path}: array items are constrained`);
    assertStrictObjectTree(node.items, `${path}.items`);
  }
  for (const keyword of ["anyOf", "oneOf"] as const) {
    if (Array.isArray(node[keyword])) node[keyword].forEach((child: unknown, index: number) => assertStrictObjectTree(child, `${path}.${keyword}[${index}]`));
  }
}

test("INT-023/INT-025: gateway sends the exact strict json_schema outside messages and traces the effective format", async (t) => {
  const runtime = validateRuntimeConfiguration(configuration() as any, secrets, { requiredCapabilities: ["fact_extraction"] });
  const expectedArtifact = runtime.resolve("fact_extraction").responseSchema;
  let providerBody: Record<string, any> | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    providerBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      id: "provider-request-1",
      model: "controlled-structured-model",
      choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ schemaVersion: "facts/v1", facts: [], conflicts: [] }) } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const persistence = new InMemoryProtectedTracePersistence();
  await executeLlmAttempt({
    configuration: runtime,
    adapter: new OpenAiCompatibleProviderAdapter(),
    protectedStore: new AdminOnlyProtectedTraceStore(persistence),
    incidents: { record() {} },
    clock: () => new Date("2026-08-26T10:00:00.000Z"),
    monotonicClock: (() => { let tick = 0; return () => ++tick; })(),
  }, {
    capability: "fact_extraction",
    correlation: { traceId: "trace-structured-1", callId: "call-1", attemptId: "attempt-1", attemptNumber: 1, workflowRunId: "run-1", workflowStage: "FACT_EXTRACTION" },
    request: { messages: [{ role: "system", content: "Return only the structured result defined by the response contract." }, { role: "user", content: { synthetic: true } }], toolDefinitions: [] },
    inputSnapshot: { materials: [], context: { synthetic: true } },
  });

  const body = asRecord(providerBody);
  assert.equal(body.response_format?.type, "json_schema");
  assert.equal(body.response_format?.json_schema?.strict, true);
  assert.match(body.response_format?.json_schema?.name, /^[A-Za-z0-9_-]{1,64}$/);
  assert.deepEqual(body.response_format?.json_schema?.schema, expectedArtifact.schema, "provider receives the exact resolved versioned schema");
  const serializedMessages = JSON.stringify(body.messages);
  assert.doesNotMatch(serializedMessages, /additionalProperties|\"properties\"\s*:|\"required\"\s*:/, "transport schema is absent from messages");

  const trace = persistence.records.get("trace-structured-1");
  assert.ok(trace, "protected trace was persisted");
  const tracedFormat = (trace.exchange.request as any).responseFormat;
  assert.deepEqual(tracedFormat, body.response_format, "trace request projection records the effective provider response format");
  assert.equal(trace.effectiveConfig.responseSchema.id, expectedArtifact.id);
  assert.equal(trace.effectiveConfig.responseSchema.version, expectedArtifact.version);
  assert.equal(trace.effectiveConfig.responseSchema.hash, expectedArtifact.hash);
  assert.doesNotMatch(JSON.stringify(trace), new RegExp(credential), "trace excludes provider credentials");
  assert.doesNotMatch(JSON.stringify(trace), /authorization/i, "trace excludes transport headers");
});

test("INT-024: schema-bearing capability fails closed when provider support is absent or false", () => {
  for (const declaration of ["missing", false] as const) {
    assert.throws(
      () => validateRuntimeConfiguration(configuration("facts/v1", declaration) as any, secrets, { requiredCapabilities: ["fact_extraction"] }),
      /structured outputs|structured_outputs|supportsStructuredOutputs/i,
    );
  }
});

test("INT-024: incompatible strict schema blocks readiness with artifact-scoped safe diagnostics", () => {
  assert.throws(
    () => validateRuntimeConfiguration(configuration("structured-object/v1", true) as any, secrets, { requiredCapabilities: ["fact_extraction"] }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /structured-object\/v1/);
      assert.match(error.message, /strict|additionalProperties|open object|required/i);
      assert.doesNotMatch(error.message, new RegExp(credential));
      return true;
    },
  );
});

test("INT-023/INT-024: refusal and length truncation are typed failures, never legacy JSON success", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const adapter = new OpenAiCompatibleProviderAdapter();
  for (const envelope of [
    { choices: [{ finish_reason: "stop", message: { role: "assistant", refusal: "cannot comply", content: null } }] },
    { choices: [{ finish_reason: "length", message: { role: "assistant", content: "{\"schemaVersion\":\"facts/v1\"" } }] },
  ]) {
    globalThis.fetch = async () => new Response(JSON.stringify(envelope), { status: 200, headers: { "content-type": "application/json" } });
    await assert.rejects(
      adapter.execute(providerAttempt()),
      (error: unknown) => error instanceof LlmProviderAttemptError && /refusal|incomplete|length|structured/i.test(JSON.stringify(error.traceError)),
    );
  }
});

test("VAC-040: full, ordinary-field and ABC generation have three distinct exact strict artifacts", () => {
  const artifacts = Object.values(RESPONSE_SCHEMA_ARTIFACTS);
  const properties = (artifact: (typeof artifacts)[number]) => {
    const value = asRecord(artifact.schema).properties;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
  };
  const full = artifacts.filter((artifact) => {
    const keys = Object.keys(properties(artifact));
    return keys.includes("profile") && keys.includes("abcDirections") && keys.includes("schemaVersion");
  });
  const field = artifacts.filter((artifact) => {
    const keys = Object.keys(properties(artifact));
    return keys.includes("field") && (keys.includes("text") || keys.includes("value")) && keys.includes("schemaVersion");
  });
  const abc = artifacts.filter((artifact) => {
    const keys = Object.keys(properties(artifact));
    return keys.includes("abcDirections") && !keys.includes("profile") && keys.includes("schemaVersion");
  });
  assert.equal(full.length, 1, "one exact full-vacancy response artifact exists");
  assert.equal(field.length, 1, "one exact ordinary-field response artifact exists");
  assert.equal(abc.length, 1, "one exact ABC response artifact exists");
  assert.equal(new Set([full[0].id, field[0].id, abc[0].id]).size, 3, "vacancy operations do not share a permissive artifact");

  for (const artifact of [full[0], field[0], abc[0]]) {
    assertStrictObjectTree(artifact.schema, artifact.id);
    const schemaVersion = properties(artifact).schemaVersion;
    assert.equal(typeof schemaVersion.const, "string", `${artifact.id}: schemaVersion is fixed`);
  }
  const fullSchema = asRecord(full[0].schema);
  const fullAbc = asRecord(asRecord(fullSchema.properties).abcDirections);
  assert.equal(fullAbc.minItems, 5, "full vacancy requires five ABC directions");
  assert.equal(fullAbc.maxItems, 5, "full vacancy permits exactly five ABC directions");
  assert.equal(asRecord(field[0].schema).additionalProperties, false, "ordinary field cannot add properties");
  assert.equal(asRecord(abc[0].schema).additionalProperties, false, "ABC result cannot add properties");
});

test("INT-023/VAC-040: production prompt builders contain semantics but no serialized schema or schema-shaped exemplar", async () => {
  const sources = await Promise.all([
    "../server/product/vacancy-provider.ts",
    "../server/product/prompt-contracts.ts",
    "../server/candidate-pipeline/router-tools.ts",
    "../server/candidate-pipeline/fact-extraction.ts",
  ].map((relative) => readFile(new URL(relative, import.meta.url), "utf8")));
  const source = sources.join("\n");
  assert.doesNotMatch(source, /JSON\.stringify\(\s*(?:config\.)?responseSchema(?:\.schema)?\s*\)/, "schemas are not serialized into prompts");
  assert.doesNotMatch(source, /matching this schema exactly/i, "prompt is not a substitute for the transport contract");
  assert.doesNotMatch(source, /Эталон формы semantic JSON|Верни только JSON\s*\{/, "vacancy prompts contain no schema-shaped transport exemplar");
  assert.match(source, /структурирован|structured/i, "short semantic structured-result instruction remains");
});
