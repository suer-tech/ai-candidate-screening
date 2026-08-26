import assert from "node:assert/strict";
import test from "node:test";
import { runCanonicalPipelineConformance, verifyCanonicalE2e } from "./helpers/canonical-pipeline-conformance-harness.mjs";

for (const testId of ["E2E-VAC-001", "E2E-TRN-001", "E2E-ABC-001", "E2E-RESULT-001"]) {
  test(`${testId}: canonical candidate pipeline local controlled conformance`, async () => {
    const result = await runCanonicalPipelineConformance();
    const failures = verifyCanonicalE2e(result, testId);
    assert.equal(failures.length, 0, failures.join("\n"));
  });
}
