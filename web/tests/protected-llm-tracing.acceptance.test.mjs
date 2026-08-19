import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readProductSource } from "./helpers/product-acceptance-harness.mjs";

const tracing = await import(pathToFileURL(path.resolve(import.meta.dirname, "../server/llm/index.ts")).href);
const secret = "acceptance-provider-secret";
const secrets = { has: (reference) => reference === "provider/main", read: (reference) => reference === "provider/main" ? secret : undefined };

function configDocument(overrides = {}) {
  return {
    releaseVersion: "acceptance-release",
    providers: { main: { provider: "controlled", endpoint: "https://llm.example.test/v1", secretReference: "provider/main", apiContractVersion: "v1" } },
    capabilities: { assessment: {
      providerProfile: "main", model: "controlled-v1", promptArtifact: "candidate-assessment/v1",
      responseSchemaArtifact: "structured-object/v1", toolSchemaArtifacts: ["no-tools/v1"], generationParameters: { temperature: 0 },
      limits: { maxOutputTokens: 1000 }, timeoutMs: 10_000,
      retryPolicy: { maxAttempts: 2, initialBackoffMs: 10, maximumBackoffMs: 100 }, fallbackPolicy: { mode: "disabled" },
      ...overrides,
    } },
  };
}

function attempt(attemptNumber = 1) {
  const config = tracing.validateRuntimeConfiguration(configDocument(), secrets, { requiredCapabilities: ["assessment"] }).resolve("assessment");
  return {
    correlation: { traceId: `trace-${attemptNumber}`, callId: `call-${attemptNumber}`, attemptId: `attempt-${attemptNumber}`, attemptNumber, workflowRunId: "run-1", workflowStage: "assessment", candidateId: "candidate-1", vacancyId: "vacancy-1" },
    capability: "assessment", config,
    request: { messages: [{ role: "user", content: "synthetic PII" }], toolDefinitions: [] },
    inputSnapshot: { materials: [{ materialId: "resume", mediaType: "text/plain", fileName: "resume.txt", content: "owned snapshot" }], context: { profile: "v1" } },
    toolEvents: attemptNumber === 1 ? [] : [{ sequence: 0, callId: "tool-1", name: "lookup", arguments: { id: 1 }, result: { ok: true } }],
    response: { rawEnvelope: { content: `response-${attemptNumber}` }, assistantMessages: [{ role: "assistant", content: `response-${attemptNumber}` }], reportedModel: "controlled-v1" },
    execution: { startedAt: "2026-08-19T10:00:00.000Z", endedAt: "2026-08-19T10:00:01.000Z", monotonicDurationMs: 1000, outcome: "succeeded" },
    createdAt: "2026-08-19T10:00:02.000Z",
  };
}

test("TST-098: every LLM attempt creates a complete self-contained exact trace", () => {
  const firstInput = attempt(1);
  const secondInput = attempt(2);
  const first = tracing.createProtectedLlmTrace(firstInput);
  const second = tracing.createProtectedLlmTrace(secondInput);
  firstInput.inputSnapshot.materials[0].content = "mutated after recording";
  assert.equal(first.inputSnapshot.materials[0].content, "owned snapshot");
  assert.notStrictEqual(first.inputSnapshot, second.inputSnapshot);
  assert.notStrictEqual(first.inputSnapshot.materials[0], second.inputSnapshot.materials[0]);
  assert.deepEqual(first.exchange.request.messages, [{ role: "user", content: "synthetic PII" }]);
  assert.deepEqual(second.exchange.toolEvents[0], { sequence: 0, callId: "tool-1", name: "lookup", arguments: { id: 1 }, result: { ok: true } });
  assert.equal(second.effectiveConfig.actualModel, "controlled-v1");
  assert.equal(second.correlation.workflowRunId, "run-1");
  assert.equal(second.execution.monotonicDurationMs, 1000);
});

test("TST-099: protected content is technical-admin-only and ordinary logs are metadata-only", async () => {
  const persistence = new tracing.InMemoryProtectedTracePersistence();
  const store = new tracing.AdminOnlyProtectedTraceStore(persistence, () => new Date("2026-08-20T00:00:00Z"));
  await store.write(tracing.createProtectedLlmTrace(attempt()));
  await assert.rejects(store.read("trace-1", { role: "hr", principalId: "hr-1" }), /access denied/i);
  const trace = await store.read("trace-1", { role: "technical-administrator", principalId: "admin-1" });
  assert.equal(trace.exchange.request.messages[0].content, "synthetic PII");
  assert.doesNotMatch(JSON.stringify(trace), new RegExp(secret));
  const source = await readProductSource();
  assert.doesNotMatch(source, /console\.(?:log|info|warn|error)\([^\n]*(?:messages|prompt|response|materials|toolEvents)/i);
});

test("TST-100: exact 30-day retention survives candidate deletion and expires exactly on schedule", async () => {
  let now = new Date("2026-08-29T10:00:02.000Z");
  const persistence = new tracing.InMemoryProtectedTracePersistence();
  const store = new tracing.AdminOnlyProtectedTraceStore(persistence, () => now);
  const trace = tracing.createProtectedLlmTrace(attempt());
  await store.write(trace);
  assert.equal(Date.parse(trace.expiresAt) - Date.parse(trace.createdAt), 30 * 24 * 60 * 60 * 1000);
  assert.ok(await store.read("trace-1", { role: "technical-administrator", principalId: "admin" }), "Trace survives the candidate's earlier app-data deletion");
  now = new Date(Date.parse(trace.expiresAt) - 1);
  assert.ok(await store.read("trace-1", { role: "technical-administrator", principalId: "admin" }));
  now = new Date(trace.expiresAt);
  assert.equal(await store.read("trace-1", { role: "technical-administrator", principalId: "admin" }), null);
});

test("TST-101: trace outage is fail-open and emits one correlated metadata-only incident", async () => {
  const incidents = [];
  const trace = tracing.createProtectedLlmTrace(attempt());
  const result = await tracing.writeProtectedTraceFailOpen(
    { write: async () => { throw new Error("store error with synthetic PII"); } },
    { record: (incident) => incidents.push(incident) }, trace,
  );
  assert.deepEqual(result, { persisted: false, incidentRecorded: true });
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].traceId, "trace-1");
  assert.equal(incidents[0].workflowRunId, "run-1");
  assert.doesNotMatch(JSON.stringify(incidents), /synthetic PII|response-1|owned snapshot/);
});

test("TST-102: startup config rejects partial/secretless config and fallback is never implicit", async () => {
  assert.throws(() => tracing.validateRuntimeConfiguration(configDocument(), { has: () => false, read: () => undefined }, { requiredCapabilities: ["assessment"] }), /missing.*credential/i);
  assert.throws(() => tracing.validateRuntimeConfiguration(configDocument({ fallbackPolicy: undefined }), secrets, { requiredCapabilities: ["assessment"] }), /fallback.*explicitly/i);
  const valid = tracing.validateRuntimeConfiguration(configDocument(), secrets, { requiredCapabilities: ["assessment"] });
  assert.deepEqual(valid.resolve("assessment").fallback, { used: false });
  assert.doesNotMatch(JSON.stringify(valid.nonSecretSnapshot), new RegExp(secret));

  const files = [];
  async function visit(root) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const absolute = path.join(root, entry.name);
      if (entry.isDirectory() && !["node_modules", "tests", ".next", "dist"].includes(entry.name)) await visit(absolute);
      else if (entry.isFile() && /(?:prompt|schema|config).+\.(?:json|ya?ml|ts|md)$/i.test(entry.name)) files.push(absolute);
    }
  }
  await visit(path.resolve(import.meta.dirname, ".."));
  const contents = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
  assert.doesNotMatch(contents, /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"']+["']/i);
});
