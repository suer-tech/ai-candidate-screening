import assert from "node:assert/strict";
import test from "node:test";
import { environmentProjection, parseReleaseEvidence, RuntimeConfigurationError, validateProcessorEndpoints } from "./runtime.ts";

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
      credentials: { "database-url": "postgresql://hh_agent:local@127.0.0.1:54329/hh_agent", "internal-service-tokens.json": "{}", "rabbitmq-password": "synthetic-rabbit-password" },
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

for (const model of ["x-ai/grok-4.7", "openai/gpt-5.6-luna-pro"])
test(`configured ${model} reaches every LLM capability and env overrides the runtime file without changing contracts`, () => {
  const previous = process.env;
  try {
    process.env = { NODE_ENV: "test" };
    const configuration = {
      values: { ...valid, APP_ORIGIN: "http://localhost:3000", ROUTERAI_MODEL: "sol", ROUTERAI_STRUCTURED_OUTPUTS: "true", CANDIDATE_PIPELINE_BUILD_ID: "build-1" },
      credentials: { "database-url": "postgresql://synthetic:synthetic@127.0.0.1:5432/synthetic", "internal-service-tokens.json": "{}", "rabbitmq-password": "synthetic-rabbit-password" },
      root: "/synthetic/config",
    };
    const baseline = environmentProjection(configuration as never);
    const baselineLlm = JSON.parse(baseline.LLM_RUNTIME_CONFIG_JSON);
    const schemas = {
      vacancy_generation: "vacancy-profile-response/v1",
      ocr: "ocr-page/v1",
      speaker_mapping: "speaker-map/v1",
      matrix_compiler: "vacancy-matrix-draft/v1",
      matrix_critic: "vacancy-matrix-critic/v2",
      criterion_claim_extraction: "candidate-claims/v1",
      unmapped_signal_discovery: "candidate-unmapped-signals/v1",
      evidence_consolidation: "candidate-evidence-consolidation/v1",
      global_conflict_detection: "candidate-global-conflicts/v1",
      matrix_row_evaluation: "candidate-matrix-rows/v2",
      matrix_assessment_summary: "candidate-assessment-summary/v1",
      abc_matrix_assessment: "candidate-abc-matrix/v1",
      critical_row_verification: "candidate-row-verification/v1",
      candidate_report_composer: "candidate-report-composition/v2",
    };
    const configured = environmentProjection({
      ...configuration,
      values: { ...configuration.values, ROUTERAI_MODEL: model },
    } as never);
    process.env.ROUTERAI_MODEL = model;
    const overridden = environmentProjection(configuration as never);
    assert.equal(configuration.values.ROUTERAI_MODEL, "sol");
    assert.deepEqual(overridden, configured);
    for (const projected of [configured, overridden]) {
      assert.equal(projected.ROUTERAI_MODEL, model);
      const llm = JSON.parse(projected.LLM_RUNTIME_CONFIG_JSON);
      assert.deepEqual(Object.keys(llm.capabilities).sort(), Object.keys(schemas).sort());
      for (const [name, responseSchemaArtifact] of Object.entries(schemas)) {
        assert.equal(baselineLlm.capabilities[name].model, "sol", name);
        assert.deepEqual(llm.capabilities[name], {
          ...baselineLlm.capabilities[name], model,
          generationParameters: model === "openai/gpt-5.6-luna-pro" ? {} : { temperature: 0 },
        }, name);
        assert.equal(llm.capabilities[name].responseSchemaArtifact, responseSchemaArtifact, name);
        assert.deepEqual(llm.capabilities[name].limits, {
          maxInputBytes: 1_000_000,
          maxOutputTokens: name === "criterion_claim_extraction" ? 16_384 : 8192,
        }, name);
      }
      assert.deepEqual(llm, { ...baselineLlm, capabilities: llm.capabilities });
      assert.deepEqual(projected, {
        ...baseline, ROUTERAI_MODEL: model, LLM_RUNTIME_CONFIG_JSON: projected.LLM_RUNTIME_CONFIG_JSON,
      });
    }
  } finally {
    process.env = previous;
  }
});

test("runtime fails closed until RouterAI Structured Outputs support is explicitly confirmed", () => {
  const configuration = {
    values: { ...valid, APP_ORIGIN: "http://localhost:3000", ROUTERAI_MODEL: "model/v1", CANDIDATE_PIPELINE_BUILD_ID: "build-1" },
    credentials: { "database-url": "postgresql://hh_agent:local@127.0.0.1:54329/hh_agent", "internal-service-tokens.json": "{}", "rabbitmq-password": "synthetic-rabbit-password" },
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
