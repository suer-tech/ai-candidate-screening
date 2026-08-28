import assert from "node:assert/strict";
import test from "node:test";
import { environmentProjection } from "../server/configuration/runtime.ts";

test("matrix-v2 heavy pre-row and downstream capabilities use the bounded ten-minute provider timeout", () => {
  const projected = environmentProjection({
    values: {
      APP_ORIGIN: "http://127.0.0.1:3000",
      ROUTERAI_MODEL: "synthetic-controlled-model",
      ROUTERAI_STRUCTURED_OUTPUTS: "true",
      CANDIDATE_PIPELINE_BUILD_ID: "synthetic-build",
      MEDIA_PROCESSOR_URL: "http://127.0.0.1:4311/v1/extract-audio",
      MEDIA_PROCESSOR_HOST: "127.0.0.1",
      MEDIA_PROCESSOR_PORT: "4311",
      DOCUMENT_PROCESSOR_URL: "http://127.0.0.1:4312/v1/extract-document",
      DOCUMENT_PROCESSOR_HOST: "127.0.0.1",
      DOCUMENT_PROCESSOR_PORT: "4312",
    },
    credentials: {
      "database-url": "postgresql://synthetic:synthetic@127.0.0.1:5432/synthetic",
      "internal-service-tokens.json": "{}",
    },
    root: "/synthetic-config",
  } as never);

  const runtime = JSON.parse(projected.LLM_RUNTIME_CONFIG_JSON) as {
    capabilities: Record<string, { timeoutMs: number }>;
  };
  const expectedTimeoutMs = 600_000;
  const heavyCapabilities = [
    "criterion_claim_extraction",
    "unmapped_signal_discovery",
    "evidence_consolidation",
    "global_conflict_detection",
    "matrix_row_evaluation",
    "abc_matrix_assessment",
    "critical_row_verification",
    "invalid_row_repair",
  ] as const;

  assert.deepEqual(
    Object.fromEntries(heavyCapabilities.map((capability) => [capability, runtime.capabilities[capability]?.timeoutMs])),
    Object.fromEntries(heavyCapabilities.map((capability) => [capability, expectedTimeoutMs])),
  );
});
