import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as matrixDriven from "../server/candidate-pipeline/matrix-driven.ts";

test("MDA-VERIFY-INCOMPLETE-RED-001: missing critical decisions are implicit verified with no remarks", () => {
  const apply = (matrixDriven as unknown as Record<string, unknown>).applyCriticalVerificationDecisions;
  assert.equal(typeof apply, "function", "matrix-driven.ts must export applyCriticalVerificationDecisions(rows, results)");
  const rows = [
    { criterionId: "critical-present", supportingClaimIds: ["claim-1"], contradictingClaimIds: [], checkedSourceIds: ["source-1"], state: "Подтверждено", reason: "Предварительно подтверждено", missingData: "", followUpQuestion: "", verificationState: "PENDING" },
    { criterionId: "critical-missing", supportingClaimIds: ["claim-2"], contradictingClaimIds: ["claim-3"], checkedSourceIds: ["source-2", "source-3"], state: "Не подтверждено", reason: "Предварительное несоответствие", missingData: "", followUpQuestion: "Уточнить", verificationState: "PENDING" },
  ];
  const partialResults = [
    { criterionId: "critical-present", decision: "VERIFIED", reason: "Подтверждено независимо", violationIds: [] },
  ];
  const adjusted = (apply as (rows: unknown[], results: unknown[]) => any[])(rows, partialResults);

  assert.deepEqual(adjusted[0], { ...rows[0], verificationState: "VERIFIED" });
  assert.deepEqual(
    adjusted[1],
    { ...rows[1], verificationState: "VERIFIED" },
    "an omitted decision means the independent critic reported no remarks; row content must remain intact",
  );
});

test("MDA-VERIFY-INCOMPLETE-RED-002: production does not terminal-fail partial verification before recommendation and reports", () => {
  const source = readFileSync(new URL("../server/candidate-pipeline/production-runtime.ts", import.meta.url), "utf8");
  const verifyStart = source.indexOf('toolKey === "candidate.matrix-verify/v1"');
  const recommendationStart = source.indexOf('toolKey === "candidate.matrix-recommendation/v1"', verifyStart);
  const reportStart = source.indexOf("pdf: {", recommendationStart);
  assert.ok(verifyStart >= 0 && recommendationStart > verifyStart, "verify and recommendation branches must exist");
  const verifyBranch = source.slice(verifyStart, recommendationStart);
  assert.doesNotMatch(verifyBranch, /MATRIX_CRITICAL_VERIFICATION_INCOMPLETE/, "missing verifier decisions are implicit VERIFIED and must not terminal-fail");
  assert.match(verifyBranch, /applyCriticalVerificationDecisions\s*\(/, "partial results must pass through fail-soft adjustment");
  assert.ok(reportStart > recommendationStart, "report pipeline must remain reachable after recommendation");
});
