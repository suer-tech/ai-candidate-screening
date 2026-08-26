import assert from "node:assert/strict";
import test from "node:test";
import { safeCandidateStageError } from "./production-runtime.ts";

test("candidate stage replaces generic masks with its observable phase", () => {
  assert.equal(safeCandidateStageError(new Error("PRODUCTION_TOOL_EXECUTION_FAILED"), "FACT_ARTIFACT_PERSIST_FAILED").message, "FACT_ARTIFACT_PERSIST_FAILED");
  assert.equal(safeCandidateStageError(new Error("private provider diagnostic"), "FACT_EXTRACTION_EXECUTION_FAILED").message, "FACT_EXTRACTION_EXECUTION_FAILED");
});

test("candidate stage preserves a specific safe upstream code", () => {
  assert.equal(safeCandidateStageError(new Error("BUDGET_DENIED:llmCalls"), "FACT_EXTRACTION_EXECUTION_FAILED").message, "BUDGET_DENIED:llmCalls");
});
