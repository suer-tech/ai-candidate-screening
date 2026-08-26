import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMatrixCapabilityOutput, UnsupportedMatrixSchemaError } from "./matrix-schemas.ts";

test("matrix capability schemas fail closed on unknown major versions", () => {
  assert.throws(() => normalizeMatrixCapabilityOutput("matrix_compiler", { schemaVersion: "vacancy-matrix-draft/v2", criteria: [] }), UnsupportedMatrixSchemaError);
  assert.equal(normalizeMatrixCapabilityOutput("matrix_compiler", { schemaVersion: "vacancy-matrix-draft/v1", criteria: [] }).schemaVersion, "vacancy-matrix-draft/v1");
});

test("critic and candidate artifacts require their canonical collections", () => {
  assert.throws(() => normalizeMatrixCapabilityOutput("matrix_critic", { schemaVersion: "vacancy-matrix-critic/v2", decision: "PASS", changes: [] }), /successor/);
  assert.throws(() => normalizeMatrixCapabilityOutput("matrix_row_evaluation", { schemaVersion: "candidate-matrix-rows/v1" }), /rows/);
  assert.equal(normalizeMatrixCapabilityOutput("critical_row_verification", { schemaVersion: "candidate-row-verification/v1", results: [] }).schemaVersion, "candidate-row-verification/v1");
  assert.throws(() => normalizeMatrixCapabilityOutput("unmapped_risk_assessment", { schemaVersion: "candidate-unmapped-risk-assessment/v1" }), /proposals/);
  assert.equal(normalizeMatrixCapabilityOutput("critical_risk_verification", { schemaVersion: "candidate-critical-risk-verification/v1", results: [] }).schemaVersion, "candidate-critical-risk-verification/v1");
});
