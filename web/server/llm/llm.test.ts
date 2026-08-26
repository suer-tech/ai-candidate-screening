import assert from "node:assert/strict";
import test from "node:test";

import {
  AdminOnlyProtectedTraceStore,
  InMemoryProtectedTracePersistence,
  PROMPT_ARTIFACTS,
  RESPONSE_SCHEMA_ARTIFACTS,
  PROTECTED_TRACE_RETENTION_MS,
  RuntimeConfigurationError,
  createProtectedLlmTrace,
  executeLlmAttempt,
  LlmProviderAttemptError,
  loadRuntimeConfiguration,
  validateRuntimeConfiguration,
  strictSchemaErrors,
  writeProtectedTraceFailOpen,
  type AttemptTraceInput,
  type CapabilityConfigDocument,
  type RuntimeConfigDocument,
  type RuntimeSecretSource,
} from "./index.ts";

test("strict Structured Outputs validator accepts closed complete schemas and rejects unsafe constructs", () => {
  assert.deepEqual(strictSchemaErrors({ type: "object", additionalProperties: false, required: ["value"], properties: { value: { type: "string" } } }), []);
  for (const [schema, pattern] of [
    [{ type: "object", additionalProperties: true }, /open object|additionalProperties/],
    [{ type: "object", additionalProperties: false, required: [], properties: { value: { type: "string" } } }, /required/],
    [{ type: "array" }, /items/],
    [{ type: "object", additionalProperties: false, required: [], properties: {}, patternProperties: {} }, /not supported/],
  ] as const) {
    assert.match(strictSchemaErrors(schema).join("\n"), pattern);
  }
});
test("every production response artifact is strict-compatible", () => {
  for (const [id, artifact] of Object.entries(RESPONSE_SCHEMA_ARTIFACTS)) {
    if (id === "structured-object/v1") continue;
    assert.deepEqual(strictSchemaErrors(artifact.schema), [], id);
  }
  assert.notEqual(RESPONSE_SCHEMA_ARTIFACTS["vacancy-profile-response/v1"].hash, RESPONSE_SCHEMA_ARTIFACTS["vacancy-field-response/v1"].hash);
  assert.notEqual(RESPONSE_SCHEMA_ARTIFACTS["vacancy-field-response/v1"].hash, RESPONSE_SCHEMA_ARTIFACTS["vacancy-abc-response/v1"].hash);
});

const secretValue = "provider-secret-that-must-not-leak";
const secrets: RuntimeSecretSource = {
  has: (reference) => reference === "provider/main",
  read: (reference) => (reference === "provider/main" ? secretValue : undefined),
};

function capabilityConfig(
  overrides: Partial<CapabilityConfigDocument> = {},
): CapabilityConfigDocument {
  return {
    providerProfile: "main",
    model: "configured-model",
    promptArtifact: "candidate-assessment/v1",
    responseSchemaArtifact: "facts/v1",
    toolSchemaArtifacts: ["no-tools/v1"],
    generationParameters: { temperature: 0 },
    limits: { maxOutputTokens: 1000 },
    timeoutMs: 30_000,
    retryPolicy: { maxAttempts: 2, initialBackoffMs: 100, maximumBackoffMs: 500 },
    fallbackPolicy: { mode: "disabled" },
    ...overrides,
  };
}

function configDocument(): RuntimeConfigDocument {
  return {
    releaseVersion: "release-2026-08-19",
    providers: {
      main: {
        provider: "configured-provider",
        endpoint: "https://llm.example.test/v1",
        secretReference: "provider/main",
        apiContractVersion: "v1",
        supportsStructuredOutputs: true,
      },
    },
    capabilities: { assessment: capabilityConfig() },
  };
}

function runtimeConfig() {
  return validateRuntimeConfiguration(configDocument(), secrets, {
    requiredCapabilities: ["assessment"],
  });
}

function traceInput(): AttemptTraceInput {
  return {
    correlation: {
      traceId: "trace-1",
      callId: "call-1",
      attemptId: "attempt-1",
      attemptNumber: 1,
      workflowRunId: "run-1",
      workflowStage: "assessment",
      candidateId: "candidate-1",
      vacancyId: "vacancy-1",
      inputVersion: "input-v2",
      profileVersion: "profile-v3",
      resultVersion: "result-v4",
      providerRequestId: "provider-request-1",
    },
    capability: "assessment",
    config: runtimeConfig().resolve("assessment"),
    request: {
      messages: [{ role: "user", content: "full candidate content" }],
      toolDefinitions: [{ name: "evidence_lookup", inputSchema: { type: "object" } }],
      toolChoice: { mode: "auto" },
    },
    inputSnapshot: {
      materials: [
        {
          materialId: "resume-1",
          mediaType: "application/pdf",
          fileName: "resume.pdf",
          content: { bytesBase64: "ZnVsbCBzbmFwc2hvdA==" },
          sourceMetadata: { revision: "42" },
        },
      ],
      context: { vacancyProfile: { title: "Analyst" } },
    },
    toolEvents: [
      {
        sequence: 0,
        callId: "tool-1",
        name: "evidence_lookup",
        arguments: { locator: "p1" },
        result: { quote: "evidence" },
      },
    ],
    response: {
      rawEnvelope: { id: "response-1", output: [{ text: "raw result" }] },
      assistantMessages: [{ role: "assistant", content: "raw result" }],
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 2 },
      parsedOutput: { recommendation: "recommended" },
      normalizedOutput: { recommendation: "recommended" },
      validationMigrationChain: [{ schema: "v1", status: "valid" }],
      reportedModel: "configured-model-2026-08",
      actualSchemaVersion: "v1",
    },
    execution: {
      startedAt: "2026-08-19T10:00:00.000Z",
      endedAt: "2026-08-19T10:00:01.250Z",
      monotonicDurationMs: 1_248.5,
      outcome: "succeeded",
      providerStatus: 200,
      retryable: false,
    },
    createdAt: "2026-08-19T10:00:02.000Z",
  };
}

test("validates required capabilities and rejects implicit fallback", () => {
  const missingFallback = configDocument();
  delete (missingFallback.capabilities.assessment as Partial<CapabilityConfigDocument>)
    .fallbackPolicy;
  assert.throws(
    () =>
      validateRuntimeConfiguration(missingFallback, secrets, {
        requiredCapabilities: ["assessment"],
      }),
    /fallback must be explicitly disabled or configured/,
  );

  assert.throws(
    () =>
      validateRuntimeConfiguration(configDocument(), secrets, {
        requiredCapabilities: ["ocr"],
      }),
    /capabilities\.ocr is required/,
  );
});

test("rejects STT as an LLM capability", () => {
  const document = configDocument() as RuntimeConfigDocument & {
    capabilities: Record<string, CapabilityConfigDocument>;
  };
  document.capabilities.stt = capabilityConfig();
  assert.throws(
    () =>
      validateRuntimeConfiguration(document, secrets, {
        requiredCapabilities: ["assessment"],
      }),
    /unknown LLM capability: stt/,
  );
});

test("keeps runtime credentials outside non-secret config and effective snapshots", () => {
  const config = runtimeConfig();
  const effective = config.resolve("assessment");
  assert.equal(config.readProviderCredential("main"), secretValue);
  assert.doesNotMatch(JSON.stringify(config.nonSecretSnapshot), new RegExp(secretValue));
  assert.doesNotMatch(JSON.stringify(effective), /provider\/main/);
  assert.doesNotMatch(JSON.stringify(effective), new RegExp(secretValue));
  assert.deepEqual(effective.defaultsArtifact, {
    id: "llm-execution-defaults",
    version: "v1",
    hash: effective.defaultsArtifact.hash,
  });
  assert.match(effective.defaultsArtifact.hash, /^sha256:[a-f0-9]{64}$/);
});

test("fails readiness validation when a required runtime credential is absent", () => {
  assert.throws(
    () =>
      validateRuntimeConfiguration(
        configDocument(),
        { has: () => false, read: () => undefined },
        { requiredCapabilities: ["assessment"] },
      ),
    /missing its runtime credential/,
  );
});

test("rejects non-JSON runtime parameters before service readiness", () => {
  const document = configDocument();
  document.capabilities.assessment = capabilityConfig({
    generationParameters: { temperature: Number.NaN },
  });
  assert.throws(
    () =>
      validateRuntimeConfiguration(document, secrets, {
        requiredCapabilities: ["assessment"],
      }),
    /finite JSON numbers/,
  );
});

test("uses explicit fallback only when the caller selects a configured policy", () => {
  const document = configDocument();
  document.capabilities.assessment = capabilityConfig({
    fallbackPolicy: {
      mode: "explicit",
      policyVersion: "fallback-v1",
      alternatives: [{ providerProfile: "main", model: "alternative-model" }],
    },
  });
  const config = validateRuntimeConfiguration(document, secrets, {
    requiredCapabilities: ["assessment"],
  });
  assert.equal(config.resolve("assessment").actualModel, "configured-model");
  const fallback = config.resolve("assessment", { explicitFallbackIndex: 0 });
  assert.equal(fallback.actualModel, "alternative-model");
  assert.deepEqual(fallback.fallback, {
    used: true,
    policyVersion: "fallback-v1",
    alternativeIndex: 0,
  });
});

test("versioned prompt artifacts contain stable content hashes", () => {
  const artifact = PROMPT_ARTIFACTS["candidate-assessment/v1"];
  assert.equal(artifact.version, "v1");
  assert.match(artifact.hash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(artifact), true);
});

test("creates an immutable self-contained exact trace per attempt", () => {
  const input = traceInput();
  const trace = createProtectedLlmTrace(input);
  (input.inputSnapshot.materials[0].content as { bytesBase64: string }).bytesBase64 = "changed";
  (input.request.messages[0] as { content: string }).content = "changed";

  assert.equal(
    (trace.inputSnapshot.materials[0].content as { bytesBase64: string }).bytesBase64,
    "ZnVsbCBzbmFwc2hvdA==",
  );
  assert.equal((trace.exchange.request.messages[0] as { content: string }).content, "full candidate content");
  assert.deepEqual(trace.exchange.toolEvents[0].result, { quote: "evidence" });
  assert.equal(Object.isFrozen(trace.inputSnapshot.materials[0]), true);
  assert.doesNotMatch(JSON.stringify(trace), new RegExp(secretValue));
});

test("creates separate owned snapshots for repeated attempts", () => {
  const firstInput = traceInput();
  const secondInput = traceInput();
  secondInput.correlation = {
    ...secondInput.correlation,
    traceId: "trace-2",
    callId: "call-2",
    attemptId: "attempt-2",
    attemptNumber: 2,
  };
  const first = createProtectedLlmTrace(firstInput);
  const second = createProtectedLlmTrace(secondInput);
  assert.notEqual(first.inputSnapshot, second.inputSnapshot);
  assert.notEqual(first.inputSnapshot.materials[0], second.inputSnapshot.materials[0]);
  assert.deepEqual(first.inputSnapshot, second.inputSnapshot);
});

test("enforces administrator-only reads and exact 30-day expiry", async () => {
  let now = new Date("2026-08-20T00:00:00.000Z");
  const persistence = new InMemoryProtectedTracePersistence();
  const store = new AdminOnlyProtectedTraceStore(persistence, () => now);
  const trace = createProtectedLlmTrace(traceInput());
  assert.equal(
    Date.parse(trace.expiresAt) - Date.parse(trace.createdAt),
    PROTECTED_TRACE_RETENTION_MS,
  );
  await store.write(trace);
  await assert.rejects(
    store.read("trace-1", { role: "hr", principalId: "hr-1" }),
    /access denied/,
  );

  now = new Date(Date.parse(trace.expiresAt) - 1);
  assert.ok(
    await store.read("trace-1", {
      role: "technical-administrator",
      principalId: "admin-1",
    }),
  );
  now = new Date(trace.expiresAt);
  assert.equal(
    await store.read("trace-1", {
      role: "technical-administrator",
      principalId: "admin-1",
    }),
    null,
  );
  assert.equal(persistence.records.size, 0);
});

test("keeps traces independent from candidate deletion lifecycle", async () => {
  const persistence = new InMemoryProtectedTracePersistence();
  const store = new AdminOnlyProtectedTraceStore(
    persistence,
    () => new Date("2026-08-29T10:00:02.000Z"),
  );
  await store.write(createProtectedLlmTrace(traceInput()));
  // There is intentionally no candidate cascade operation on this isolated persistence boundary.
  assert.ok(
    await store.read("trace-1", {
      role: "technical-administrator",
      principalId: "admin-1",
    }),
  );
});

test("fails open and emits only correlated metadata when protected storage is unavailable", async () => {
  const incidents: unknown[] = [];
  const trace = createProtectedLlmTrace(traceInput());
  const result = await writeProtectedTraceFailOpen(
    { write: async () => { throw new Error("failure containing private payload"); } },
    { record: (incident) => { incidents.push(incident); } },
    trace,
    () => new Date("2026-08-19T10:00:03.000Z"),
  );
  assert.deepEqual(result, { persisted: false, incidentRecorded: true });
  assert.equal(incidents.length, 1);
  const serialized = JSON.stringify(incidents[0]);
  assert.match(serialized, /trace-1/);
  assert.match(serialized, /protected_trace_write_failed/);
  assert.doesNotMatch(serialized, /full candidate content|private payload|raw result|resume\.pdf/);
});

test("does not block workflow even when both protected and incident sinks fail", async () => {
  const trace = createProtectedLlmTrace(traceInput());
  const result = await writeProtectedTraceFailOpen(
    { write: async () => { throw new Error("store down"); } },
    { record: () => { throw new Error("logs down"); } },
    trace,
  );
  assert.deepEqual(result, { persisted: false, incidentRecorded: false });
});

test("rejects secret-bearing provider endpoints without echoing secret values", () => {
  const document = configDocument();
  document.providers.main.endpoint = "https://llm.example.test/v1?api_key=do-not-echo";
  let error: unknown;
  try {
    validateRuntimeConfiguration(document, secrets, { requiredCapabilities: ["assessment"] });
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof RuntimeConfigurationError);
  assert.match(error.message, /secret query parameters/);
  assert.doesNotMatch(error.message, /do-not-echo/);
});

test("gateway executes through effective config and persists the exact attempt without credentials", async () => {
  const persistence = new InMemoryProtectedTracePersistence();
  const store = new AdminOnlyProtectedTraceStore(persistence);
  const observedCredentials: string[] = [];
  const source = traceInput();
  let clockIndex = 0;
  const times = [new Date("2026-08-19T10:00:00.000Z"), new Date("2026-08-19T10:00:01.000Z")];
  const result = await executeLlmAttempt({
    configuration: runtimeConfig(),
    adapter: {
      async execute(request) {
        observedCredentials.push(request.credential);
        return {
          providerRequestId: "provider-gateway-1",
          reportedModel: "configured-model-2026-08",
          providerStatus: 200,
          rawEnvelope: { output: "exact response" },
          assistantMessages: [{ role: "assistant", content: "exact response" }],
          finishReason: "stop",
          toolEvents: source.toolEvents,
        };
      },
    },
    protectedStore: store,
    incidents: { record() { throw new Error("must not emit"); } },
    clock: () => times[Math.min(clockIndex++, times.length - 1)],
    monotonicClock: (() => { let tick = 100; return () => (tick += 25); })(),
  }, {
    capability: "assessment",
    correlation: { ...source.correlation, providerRequestId: undefined },
    request: source.request,
    inputSnapshot: source.inputSnapshot,
  });
  assert.deepEqual(observedCredentials, [secretValue]);
  assert.deepEqual(result.trace, { persisted: true, incidentRecorded: false });
  const trace = persistence.records.get("trace-1");
  assert.ok(trace);
  assert.equal(trace.correlation.providerRequestId, "provider-gateway-1");
  assert.deepEqual(trace.exchange.toolEvents, source.toolEvents);
  assert.doesNotMatch(JSON.stringify(trace), new RegExp(secretValue));
});

test("gateway traces provider failure and preserves the business failure during trace outage", async () => {
  const incidents: unknown[] = [];
  const source = traceInput();
  const providerError = new LlmProviderAttemptError("provider unavailable", { class: "rate_limit" }, 429, true, 500);
  await assert.rejects(
    executeLlmAttempt({
      configuration: runtimeConfig(),
      adapter: { execute: async () => { throw providerError; } },
      protectedStore: { write: async () => { throw new Error("trace store unavailable"); } },
      incidents: { record: (incident) => { incidents.push(incident); } },
      clock: () => new Date("2026-08-19T10:00:00.000Z"),
      monotonicClock: () => 10,
    }, {
      capability: "assessment",
      correlation: { ...source.correlation, providerRequestId: undefined },
      request: source.request,
      inputSnapshot: source.inputSnapshot,
    }),
    (error) => error === providerError,
  );
  assert.equal(incidents.length, 1);
  assert.doesNotMatch(JSON.stringify(incidents), /full candidate content|rate_limit|provider unavailable/);
});

test("runtime loader separates versioned non-secret config from environment credentials", () => {
  const config = loadRuntimeConfiguration({
    LLM_RUNTIME_CONFIG_JSON: JSON.stringify(configDocument()),
    "provider/main": secretValue,
  }, ["assessment"]);
  assert.equal(config.readProviderCredential("main"), secretValue);
  assert.doesNotMatch(JSON.stringify(config.nonSecretSnapshot), new RegExp(secretValue));
  assert.throws(() => loadRuntimeConfiguration({ LLM_RUNTIME_CONFIG_JSON: "{}" }, ["assessment"]), /releaseVersion|providers/);
});
