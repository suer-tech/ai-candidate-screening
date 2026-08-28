import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as matrixDriven from "../server/candidate-pipeline/matrix-driven.ts";

test("MDA-007: rejected or omitted auxiliary verification preserves the original row and evidence links", () => {
  const apply = (matrixDriven as unknown as Record<string, unknown>).applyCriticalVerificationDecisions;
  assert.equal(typeof apply, "function", "matrix-driven.ts must export applyCriticalVerificationDecisions(rows, results)");
  const rows = [
    { criterionId: "verified-row", supportingClaimIds: ["claim-v"], contradictingClaimIds: [], checkedSourceIds: ["source-v"], state: "Подтверждено", reason: "Исходное подтверждение", missingData: "", followUpQuestion: "", verificationState: "PENDING" },
    { criterionId: "rejected-row", supportingClaimIds: ["claim-r"], contradictingClaimIds: ["claim-c"], checkedSourceIds: ["source-r"], state: "Подтверждено", reason: "Предварительный вывод", missingData: "", followUpQuestion: "Уточнить детали", verificationState: "PENDING" },
  ];
  const results = [
    { criterionId: "verified-row", decision: "VERIFIED", reason: "Проверка пройдена", violationIds: [] },
    { criterionId: "rejected-row", decision: "REJECTED", reason: "Доказательство не подтверждает вывод", violationIds: ["EVIDENCE_INSUFFICIENT"] },
  ];
  const adjusted = (apply as (rows: unknown[], results: unknown[]) => any[])(rows, results);
  assert.equal(adjusted.length, 2);
  assert.deepEqual(adjusted[0], { ...rows[0], verificationState: "VERIFIED" }, "VERIFIED row content must remain intact");
  assert.equal(adjusted[1].state, rows[1].state, "REJECTED auxiliary verification must not downgrade the evaluator row");
  assert.equal(adjusted[1].verificationState, "REJECTED");
  assert.deepEqual(adjusted[1].supportingClaimIds, ["claim-r"]);
  assert.deepEqual(adjusted[1].contradictingClaimIds, ["claim-c"]);
  assert.deepEqual(adjusted[1].checkedSourceIds, ["source-r"]);
  assert.match(adjusted[1].reason, /Предварительный вывод/);
  assert.match(adjusted[1].reason, /Доказательство не подтверждает вывод/);
  assert.equal(adjusted[1].missingData, rows[1].missingData);
  const omitted = (apply as (rows: unknown[], results: unknown[]) => any[])([rows[1]], []);
  assert.deepEqual(omitted[0], { ...rows[1], verificationState: "VERIFIED" },
    "omitted verifier means no remarks: preserve the evaluator conclusion and only close verification metadata implicitly");
  assert.throws(
    () => (apply as (rows: unknown[], results: unknown[]) => unknown)(rows, [{ criterionId: "unknown-row", decision: "REJECTED", reason: "x", violationIds: [] }]),
    /UNKNOWN|unknown/i,
    "verification results for unknown criterion IDs must fail closed",
  );
});

test("MDA-007/ASM-050: production verification is fail-soft and recommendation is holistic except the stop-factor override", () => {
  const source = readFileSync(new URL("../server/candidate-pipeline/production-runtime.ts", import.meta.url), "utf8");
  const verifyStart = source.indexOf('toolKey === "candidate.matrix-verify/v1"');
  const recommendationStart = source.indexOf('toolKey === "candidate.matrix-recommendation/v1"', verifyStart);
  const recommendationEnd = source.indexOf('throw new Error("MATRIX_TOOL_NOT_REGISTERED")', recommendationStart);
  assert.ok(verifyStart >= 0 && recommendationStart > verifyStart && recommendationEnd > recommendationStart);
  const verifyBranch = source.slice(verifyStart, recommendationStart);
  const recommendationBranch = source.slice(recommendationStart, recommendationEnd);
  assert.match(verifyBranch, /applyCriticalVerificationDecisions\s*\(/, "verify branch must persist fail-soft adjusted rows");
  assert.match(verifyBranch, /CRITICAL_ROW_VERIFICATION_FAILED_PRESERVED_ORIGINAL/, "verifier failure must explicitly preserve the evaluator result");
  assert.doesNotMatch(recommendationBranch, /MATRIX_CRITICAL_VERIFICATION_REJECTED/, "REJECTED verification is uncertainty, not a terminal runtime error");
  assert.doesNotMatch(recommendationBranch, /deriveMatrixRecommendation\s*\(/, "the legacy deterministic required/risk formula must not decide new runs");
  assert.match(recommendationBranch, /holisticRecommendation|HOLISTIC_LLM/, "recommendation must consume holistic synthesis output");
  assert.match(recommendationBranch, /triggeredStops[\s\S]{0,180}Не рекомендовать/, "only a confirmed explicit stop factor remains a deterministic override");
  assert.match(recommendationBranch, /(?:adjusted|verified|effective)Rows/, "holistic synthesis must consume the final preserved/adjusted rows");
});
