import assert from "node:assert/strict";
import test from "node:test";
import { environmentProjection, parseReleaseEvidence, parseRuntimeEnv, RuntimeConfigurationError, validateProcessorEndpoints } from "./runtime.ts";

const valid = {
  MEDIA_PROCESSOR_URL: "http://127.0.0.1:4311/v1/extract-audio",
  MEDIA_PROCESSOR_HOST: "127.0.0.1",
  MEDIA_PROCESSOR_PORT: "4311",
  DOCUMENT_PROCESSOR_URL: "http://127.0.0.1:4312/v1/extract-document",
  DOCUMENT_PROCESSOR_HOST: "127.0.0.1",
  DOCUMENT_PROCESSOR_PORT: "4312",
};

test("processor endpoints use the configured loopback host, port, and exact route", () => {
  assert.doesNotThrow(() => validateProcessorEndpoints(valid));
  assert.throws(
    () => validateProcessorEndpoints({ ...valid, MEDIA_PROCESSOR_URL: "http://127.0.0.1:4080/v1/extract-audio" }),
    (error) => error instanceof RuntimeConfigurationError && error.safeCode === "MEDIA_PROCESSOR_ENDPOINT_MISMATCH",
  );
  assert.throws(
    () => validateProcessorEndpoints({ ...valid, DOCUMENT_PROCESSOR_URL: "http://127.0.0.1:4312" }),
    (error) => error instanceof RuntimeConfigurationError && error.safeCode === "DOCUMENT_PROCESSOR_ENDPOINT_MISMATCH",
  );
});

test("docker environment overrides reroute processor endpoints and database url inside a compose network", () => {
  const previous = { ...process.env };
  try {
    process.env.MEDIA_PROCESSOR_URL = "http://media-processor:4311/v1/extract-audio";
    process.env.MEDIA_PROCESSOR_HOST = "media-processor";
    process.env.MEDIA_PROCESSOR_PORT = "4311";
    process.env.DOCUMENT_PROCESSOR_URL = "http://document-processor:4312/v1/extract-document";
    process.env.DOCUMENT_PROCESSOR_HOST = "document-processor";
    process.env.DOCUMENT_PROCESSOR_PORT = "4312";
    process.env.DATABASE_URL = "postgresql://hh_agent:compose-password@postgres:5432/hh_agent";
    process.env.HOST = "0.0.0.0";
    process.env.INTERNAL_APP_ORIGIN = "http://web:3000";
    const configuration = {
      values: { ...valid, APP_ORIGIN: "http://localhost:3000", INTERNAL_APP_ORIGIN: "http://127.0.0.1:3000", HOST: "127.0.0.1", ROUTERAI_MODEL: "model/v1", ROUTERAI_STRUCTURED_OUTPUTS: "true", CANDIDATE_PIPELINE_BUILD_ID: "build-1" },
      credentials: { "database-url": "postgresql://hh_agent:local@127.0.0.1:54329/hh_agent", "internal-service-tokens.json": "{}" },
      root: "/config",
    } as never;
    const projected = environmentProjection(configuration);
    assert.equal(projected.MEDIA_PROCESSOR_URL, "http://media-processor:4311/v1/extract-audio");
    assert.equal(projected.DOCUMENT_PROCESSOR_URL, "http://document-processor:4312/v1/extract-document");
    assert.equal(projected.DATABASE_URL, "postgresql://hh_agent:compose-password@postgres:5432/hh_agent");
    assert.equal(projected.HOST, "0.0.0.0");
    assert.equal(projected.INTERNAL_APP_ORIGIN, "http://web:3000");
    assert.equal(projected.AGENT_RUNTIME_ENDPOINT, "http://web:3000/api/internal/agent-runtime");
    assert.equal(projected.CANDIDATE_TOOL_ENDPOINT, "http://web:3000/api/internal/candidate-pipeline/tool");
  } finally {
    process.env = previous;
  }
});

test("runtime fails closed until RouterAI Structured Outputs support is explicitly confirmed", () => {
  const configuration = {
    values: { ...valid, APP_ORIGIN: "http://localhost:3000", ROUTERAI_MODEL: "model/v1", CANDIDATE_PIPELINE_BUILD_ID: "build-1" },
    credentials: { "database-url": "postgresql://hh_agent:local@127.0.0.1:54329/hh_agent", "internal-service-tokens.json": "{}" },
    root: "/config",
  } as never;
  assert.throws(() => environmentProjection(configuration), /ROUTERAI_STRUCTURED_OUTPUTS_SUPPORT_REQUIRED/);
});

test("release evidence is fixed-path, bounded, complete, and contains no secret-shaped fields", () => {
  const validEvidence = { buildId: "build-123", configurationFingerprint: "config-123", pairRecoveryGreen: true, outboxRecoveryGreen: true, hardBudgetsVerified: true };
  assert.deepEqual(JSON.parse(parseReleaseEvidence(JSON.stringify(validEvidence))), validEvidence);
  assert.throws(() => parseReleaseEvidence(JSON.stringify({ ...validEvidence, providerToken: "forbidden" })), /RELEASE_EVIDENCE_UNSAFE_FIELD/);
  assert.throws(() => parseReleaseEvidence(JSON.stringify({ ...validEvidence, hardBudgetsVerified: false })), /RELEASE_EVIDENCE_INCOMPLETE/);
});

test("matrix assessment routing accepts only disabled, shadow, or production", () => {
  for (const mode of ["disabled", "shadow", "production"]) assert.equal(parseRuntimeEnv(`MATRIX_ASSESSMENT_ROUTING=${mode}`).MATRIX_ASSESSMENT_ROUTING, mode);
  assert.throws(() => parseRuntimeEnv("MATRIX_ASSESSMENT_ROUTING=effectful"), /MATRIX_ASSESSMENT_ROUTING_INVALID/);
});
