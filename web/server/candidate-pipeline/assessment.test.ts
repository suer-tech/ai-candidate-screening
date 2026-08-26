import assert from "node:assert/strict";
import test from "node:test";
import { assessAbcDirections, assessCriteria, assessmentInputs, buildEvidenceGraph, createAssessmentSnapshot, repairAssessment, validateAssessmentSnapshot, type ProfileCriterion } from "./assessment.ts";
import type { EvidenceFact } from "./types.ts";

const locator = { kind: "document" as const, fileId: "resume", fileVersion: "1", artifactId: "document-1", fileName: "resume.pdf", exactText: "есть опыт", page: 1, section: "Опыт" };
const fact = (id: string, predicate: string, value = "yes"): EvidenceFact => ({ id, subject: "candidate-1", predicate, value, confidence: 0.9, significant: true, locator, provenance: { tool: "facts", toolVersion: "1", schemaVersion: "facts/v1", traceId: `trace-${id}` } });
const profile: ProfileCriterion[] = [
  { id: "experience", title: "Опыт", category: "required-experience", predicate: "experience", required: true, expectedValue: "yes" },
  { id: "access", title: "Доступ", category: "access-to-ke", predicate: "access", required: true, expectedValue: "yes" },
  { id: "stop", title: "Стоп", category: "stop-factor", predicate: "stop", required: false, expectedValue: "yes" },
];

test("evidence graph represents conflict and forbids unsupported significant claims", () => {
  const facts = [fact("one", "experience", "yes"), fact("two", "experience", "no")];
  const graph = buildEvidenceGraph(facts, [{ id: "conflict-1", predicate: "experience", factIds: ["one", "two"], resolved: false }]);
  assert.equal(assessCriteria(graph, profile)[0].state, "Противоречие источников");
  assert.throws(() => buildEvidenceGraph([{ ...fact("bad", "x"), locator: { ...locator, exactText: "" } }], []), /SIGNIFICANT_CLAIM_WITHOUT_LOCATOR/);
});

test("criteria, access and explicit stop-factor feed ASM-050 while ABC remains informational", () => {
  const graph = buildEvidenceGraph([fact("experience", "experience"), fact("access", "access"), fact("stop", "stop")], []);
  const criteria = assessCriteria(graph, profile);
  const inputs = assessmentInputs(profile, criteria, { achievements: "A" });
  const snapshot = createAssessmentSnapshot({ attempt: 1, inputVersion: "input-1", profileVersion: "profile-1", toolVersions: { facts: "1", assessment: "1" }, modelVersion: "controlled-1", policyVersion: "candidate-policy-v1", evidenceGraphChecksum: "graph", criteria, inputs });
  assert.equal(snapshot.recommendation, "Не рекомендовать");
  assert.equal(validateAssessmentSnapshot(snapshot, graph, profile).decision, "PASS");
  assert.equal(createAssessmentSnapshot({ attempt: 1, inputVersion: "input-1", profileVersion: "profile-1", toolVersions: { facts: "1", assessment: "1" }, modelVersion: "controlled-1", policyVersion: "candidate-policy-v1", evidenceGraphChecksum: "graph", criteria, inputs }).id, snapshot.id);
});

test("insufficient required evidence wins over risks and bounded repair creates immutable successor", () => {
  const graph = buildEvidenceGraph([fact("risk", "risk")], []);
  const criteria = assessCriteria(graph, profile);
  const inputs = assessmentInputs(profile, criteria, { achievements: "C" });
  const first = createAssessmentSnapshot({ attempt: 1, inputVersion: "input-1", profileVersion: "profile-1", toolVersions: { assessment: "1" }, modelVersion: "controlled-1", policyVersion: "candidate-policy-v1", evidenceGraphChecksum: "graph", criteria, inputs });
  assert.equal(first.recommendation, "Недостаточно данных");
  const successor = repairAssessment(first, { criteria, inputs }, ["CONTROLLED_REPAIR"]);
  assert.equal(successor.predecessorId, first.id);
  assert.equal(successor.attempt, 2);
  assert.notEqual(successor.id, first.id);
  assert.throws(() => repairAssessment(successor, { criteria, inputs }, ["AGAIN"]), /BOUNDED_REPAIR_EXHAUSTED/);
});

test("ABC directions use A/B/C, conflict and insufficient states without changing recommendation", () => {
  const graph = buildEvidenceGraph([fact("abc-a", "abc:achievements", "A"), fact("abc-b", "abc:scale", "B"), fact("abc-c", "abc:scale", "C")], []);
  assert.deepEqual(assessAbcDirections(["achievements", "scale", "motivation"], graph).map((item) => item.state), ["A", "CONFLICT", "Недостаточно данных"]);
});
