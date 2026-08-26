import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { evaluatePrivateBenchmark, PrivateBenchmarkFirewall, type PrivateBenchmarkOracle } from "./private-benchmark-firewall.ts";

const reference = new TextEncoder().encode("synthetic reference report bytes");
const digest = createHash("sha256").update(reference).digest("hex");

test("reference checksum and derived anchor are blocked before all external boundaries", () => {
  const firewall = new PrivateBenchmarkFirewall({ denyChecksums: [digest], referenceAnchors: ["synthetic critical reference anchor that must remain entirely offline"] });
  assert.throws(() => firewall.assertInputManifest([{ role: "pipeline-input", checksum: digest }]), /REFERENCE_IN_INPUT/);
  for (const boundary of ["drive", "provider", "blob"] as const) assert.throws(() => firewall.assertPayloadAllowed(reference, boundary), /REFERENCE_DENIED/);
  let called = false;
  assert.throws(() => firewall.providerCall(new TextEncoder().encode("synthetic critical reference anchor that must remain entirely offline"), async () => { called = true; }), /REFERENCE_TEXT_DENIED/);
  assert.equal(called, false);
  assert.equal(firewall.evidence().providerCalls, 0);
});

test("offline oracle enforces every hard quality threshold without an LLM judge", () => {
  const oracle: PrivateBenchmarkOracle = { expectedRecommendation: "Рекомендовать", abcDirections: [{ title: "инициатива", grade: "A" }], anchors: [{ id: "a", normalizedText: "подтвержденный критический факт профессионального опыта кандидата", category: "critical-fact" }], requiredSections: ["recommendation", "evidence"], thresholds: { requiredSectionRecall: 1, significantClaimEvidenceRecall: 1, criticalAnchorRecallMinimum: 0.85, abcGradeMatchMinimum: 0.8, gradeInversionsMaximum: 0, inventedStopFactorsMaximum: 0 } };
  const green = evaluatePrivateBenchmark(oracle, { recommendation: "Рекомендовать", abcDirections: [{ title: "инициатива", grade: "A" }], claims: [{ significant: true, evidenceLocator: "page:1" }], stopFactors: [], sections: ["recommendation", "evidence"], normalizedEvidenceText: oracle.anchors[0].normalizedText });
  assert.equal(green.status, "GREEN");
  assert.equal(evaluatePrivateBenchmark(oracle, { recommendation: "Не рекомендовать", abcDirections: [{ title: "инициатива", grade: "C" }], claims: [{ significant: true }], stopFactors: [{ invented: true }], sections: [], normalizedEvidenceText: "" }).status, "RED");
});
