import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("ASM-073: versioned open-pass schema is balanced across STRENGTH, CONCERN and QUESTION", () => {
  const source = readFileSync(new URL("../server/llm/artifacts.ts", import.meta.url), "utf8");
  const schema = source.match(/"candidate-unmapped-signals\/v1"[\s\S]{0,1600}?\}\s*\}\s*\}\s*\),/)?.[0] ?? source;
  assert.match(schema, /observationType/);
  assert.match(schema, /STRENGTH/);
  assert.match(schema, /CONCERN/);
  assert.match(schema, /QUESTION/);
  assert.match(schema, /decisionEffect[^\n]*INFORMATIONAL/, "balanced observations remain informational until holistic synthesis");
});

test("ASM-073/ASM-050: new production runs do not require the assess/verify critical-risk cascade", () => {
  const source = readFileSync(new URL("../server/candidate-pipeline/production-runtime.ts", import.meta.url), "utf8");
  const verifyStart = source.indexOf('toolKey === "candidate.matrix-verify/v1"');
  const recommendationStart = source.indexOf('toolKey === "candidate.matrix-recommendation/v1"', verifyStart);
  const recommendationEnd = source.indexOf('throw new Error("MATRIX_TOOL_NOT_REGISTERED")', recommendationStart);
  assert.ok(verifyStart >= 0 && recommendationStart > verifyStart && recommendationEnd > recommendationStart);
  const verify = source.slice(verifyStart, recommendationStart);
  const recommendation = source.slice(recommendationStart, recommendationEnd);

  assert.doesNotMatch(verify, /unmapped_risk_assessment|critical_risk_verification/, "auxiliary critical-risk cascade is not required by new runs");
  assert.match(verify, /criticalRisks\s*:\s*\[\]/, "backward-compatible artifact shape records no new critical-risk cascade output");
  assert.match(recommendation, /observationType\s*===\s*["']STRENGTH["']/);
  assert.match(recommendation, /observationType\s*===\s*["']CONCERN["']/);
  assert.match(recommendation, /holisticRecommendation|HOLISTIC_LLM/);
  assert.doesNotMatch(recommendation, /verifiedCriticalUnmappedRisks|deriveMatrixRecommendation\s*\(/);
});
