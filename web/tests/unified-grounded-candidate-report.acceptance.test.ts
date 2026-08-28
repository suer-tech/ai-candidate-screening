import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createSyntheticRegistries } from "../server/agent-runtime/registry.ts";
import { registerCanonicalCandidatePipeline } from "../server/candidate-pipeline/goal.ts";
import * as reportsApi from "../server/candidate-pipeline/reports.ts";
import { createDocumentProcessorServer } from "../server/document-processor/server.ts";
import { PROMPT_ARTIFACTS, RESPONSE_SCHEMA_ARTIFACTS } from "../server/llm/artifacts.ts";

const sectionIds = [
  "identity", "sources", "organizational-conditions", "review", "key-evidence", "abc-directions",
  "technical-check", "motivation-fit", "risks", "decision", "final-summary",
] as const;

const decisionSnapshot = {
  recommendation: "Рекомендовать с оговорками",
  abcGrades: { productivity: "B", autonomy: "A" },
  matrixRows: [
    { criterionId: "criterion-1", state: "Соответствует", conclusion: "Готовит встречи заранее", evidenceIds: ["evidence-1"] },
    { criterionId: "criterion-2", state: "Недостаточно данных", conclusion: "Нужно уточнить объём полномочий", evidenceIds: [] },
  ],
};
const evidenceCatalog = [{ evidenceId: "evidence-1", quote: "Готовил материалы за день до встречи", source: "Резюме, стр. 2" }];

test("REP-023: matrix-v3 plan has one report artifact and one publication, while legacy pair is not used for new runs", () => {
  const registries = createSyntheticRegistries();
  registerCanonicalCandidatePipeline(registries.tools, registries.goals);
  const plan = registries.goals.createPlan({ goalType: "candidate-analysis-matrix/v1", goalId: "goal", runId: "run", candidateId: "synthetic",
    inputVersion: "input-v1", profileVersion: "profile-v1", policyVersion: "candidate-policy-v1", completionCriteriaVersion: "candidate-completion-v1",
    completionCriteria: ["validated-candidate-report", "ready-after-report-publication"], budgets: { wallTimeMs: 1, taskAttempts: 1, repairAttempts: 1, replans: 1, llmCalls: 1, tokens: 1, costMicrounits: 1, externalRequests: 1 } });
  const reportTasks = plan.filter((task) => task.key === "reports");
  const publicationTasks = plan.filter((task) => task.key === "publication");
  const failures: string[] = [];
  if (reportTasks.length !== 1) failures.push(`expected one reports task, actual=${reportTasks.length}`);
  if (reportTasks[0]?.tool !== "candidate.report/v1") failures.push(`new run uses ${reportTasks[0]?.tool ?? "missing"} instead of singular candidate.report/v1`);
  if (JSON.stringify(reportTasks[0]?.expectedOutputs) !== JSON.stringify(["candidate-report-pdf"])) failures.push(`report outputs are not singular: ${JSON.stringify(reportTasks[0]?.expectedOutputs)}`);
  if (publicationTasks.length !== 1 || JSON.stringify(publicationTasks[0]?.expectedOutputs) !== JSON.stringify(["published-candidate-report"])) failures.push("publication contract is not exactly one candidate report");
  if (plan.some((task) => task.tool.includes("report-pair") || task.expectedOutputs.some((output) => /abc-pdf|result-pdf|pair/.test(output)))) failures.push("new matrix-v3 plan still invokes legacy pair contract");
  assert.deepEqual(failures, []);
});

test("REP-023: candidate-report model exposes every mandatory HR section exactly once", () => {
  const failures: string[] = [];
  let actual: string[] = [];
  try { actual = (reportsApi.requiredReportSections as (type: string) => string[])("candidate-report"); }
  catch (error) { failures.push(`candidate-report type unsupported: ${String(error)}`); }
  for (const id of sectionIds) if (actual.filter((item) => item === id).length !== 1) failures.push(`${id}: expected exactly once`);
  if (new Set(actual).size !== actual.length) failures.push("mandatory section registry contains duplicates");
  assert.deepEqual(failures, []);
});

test("REP-023: report composer artifacts accept compact validated decisions, not raw materials", () => {
  const prompt = (PROMPT_ARTIFACTS as Record<string, { template?: string }>)["compose-candidate-report/v2"];
  const schema = (RESPONSE_SCHEMA_ARTIFACTS as Record<string, { schema?: unknown }>)["candidate-report-composition/v2"];
  const failures: string[] = [];
  if (!prompt?.template) failures.push("compose-candidate-report/v2 prompt artifact is missing");
  if (!schema?.schema) failures.push("candidate-report-composition/v2 response schema is missing");
  const contract = JSON.stringify({ prompt, schema });
  const schemaContract = JSON.stringify(schema);
  for (const required of ["recommendation", "abc", "matrix", "evidenceIds"]) if (!new RegExp(required, "i").test(contract)) failures.push(`composer contract omits ${required}`);
  for (const forbidden of ["rawResume", "resumeBytes", "rawTranscript", "transcriptWords", "documents", "materials"]) if (new RegExp(forbidden, "i").test(schemaContract)) failures.push(`composer schema accepts forbidden bulk field ${forbidden}`);
  assert.deepEqual(failures, []);
});

test("REP-023: composer validation preserves decisions, resolves evidence, deduplicates narrative and fails soft", async () => {
  const api = reportsApi as unknown as { composeCandidateReportFailSoft?: (input: unknown) => Promise<{ model: Record<string, unknown>; usedFallback: boolean; warnings: string[] }> };
  assert.equal(typeof api.composeCandidateReportFailSoft, "function", "public fail-soft candidate-report composition boundary is missing");
  const validNarrative = { sections: sectionIds.map((sectionId) => ({ sectionId, statements: [{ text: `Синтетический вывод ${sectionId}`, evidenceIds: ["evidence-1"] }] })), decisionSnapshot };
  const base = { decisionSnapshot, evidenceCatalog, compactInput: true, rawResume: undefined, rawTranscript: undefined };
  const valid = await api.composeCandidateReportFailSoft!({ ...base, composer: async () => validNarrative });
  assert.equal(valid.usedFallback, false);
  assert.deepEqual((valid.model as { decisionSnapshot?: unknown }).decisionSnapshot, decisionSnapshot);
  const duplicateNarrative = { ...validNarrative, sections: [{ sectionId: "strengths", statements: [{ text: "Один вывод", evidenceIds: ["evidence-1"] }] }, { sectionId: "risks", statements: [{ text: "Один вывод", evidenceIds: ["evidence-1"] }] }] };
  const deduplicated = await api.composeCandidateReportFailSoft!({ ...base, composer: async () => duplicateNarrative });
  assert.equal((JSON.stringify(deduplicated.model).match(/Один вывод/g) ?? []).length, 1, "same narrative conclusion must be emitted once");

  for (const [name, composer] of [
    ["invalid-schema", async () => ({ invalid: true })],
    ["timeout", async () => { throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }); }],
    ["unknown-evidence", async () => ({ ...validNarrative, sections: [{ sectionId: "strengths", statements: [{ text: "Вывод", evidenceIds: ["evidence-unknown"] }] }] })],
    ["decision-mutation", async () => ({ ...validNarrative, decisionSnapshot: { ...decisionSnapshot, recommendation: "Не рекомендовать", abcGrades: { productivity: "C" }, matrixRows: [{ ...decisionSnapshot.matrixRows[0], state: "Не соответствует" }] } })],
  ] as const) {
    const result = await api.composeCandidateReportFailSoft!({ ...base, composer });
    assert.equal(result.usedFallback, true, `${name}: deterministic fallback not selected`);
    assert.deepEqual((result.model as { decisionSnapshot?: unknown }).decisionSnapshot, decisionSnapshot, `${name}: fallback mutated decisions`);
    assert.ok(result.warnings.length, `${name}: protected warning missing`);
  }
});

test("REP-023: singular document endpoint returns one candidate-report PDF", async () => {
  const token = "synthetic-document-token-000000000000";
  const server = createDocumentProcessorServer({ token, host: "127.0.0.1", port: 0, maxInputBytes: 2_000_000 });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const address = server.address(); assert(address && typeof address === "object");
    const model = { type: "candidate-report", candidateId: "synthetic", candidateDisplayName: "Synthetic Candidate", vacancyId: "vacancy", vacancyTitle: "Assistant",
      profileVersion: "profile-v1", analysisVersion: 1, generatedAtUtc: "2026-08-27T00:00:00Z", recommendation: decisionSnapshot.recommendation,
      decisionSnapshot, evidenceCatalog, sections: sectionIds.map((id) => ({ id, title: id, body: `Синтетический раздел ${id}` })), evidence: [] };
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/render-candidate-report`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ model }) });
    const payload = await response.json() as { schemaVersion?: string; report?: { type?: string; bytesBase64?: string; checksum?: string }; reports?: unknown[] };
    assert.equal(response.status, 200);
    assert.equal(payload.schemaVersion, "rendered-candidate-report/v1");
    assert.equal(payload.report?.type, "candidate-report");
    assert.equal(payload.reports, undefined, "singular endpoint must not return a pair collection");
    assert.match(Buffer.from(payload.report?.bytesBase64 ?? "", "base64").subarray(0, 5).toString(), /^%PDF/);
    assert.ok(payload.report?.checksum);
  } finally { server.close(); await once(server, "close"); }
});

test("REP-023: production orchestration is singular/fail-soft; legacy pair remains read compatibility only", async () => {
  const source = await readFile(new URL("../server/candidate-pipeline/production-runtime.ts", import.meta.url), "utf8");
  const serverSource = await readFile(new URL("../server/document-processor/server.ts", import.meta.url), "utf8");
  const failures: string[] = [];
  if (!source.includes("/v1/render-candidate-report")) failures.push("new reports stage does not call singular renderer");
  if (source.includes('new URL("/v1/render-report-pair"')) failures.push("new reports stage still calls legacy pair renderer");
  if (!/composeCandidateReportFailSoft|REPORT_COMPOSER_[A-Z_]+[\s\S]{0,1200}fallback/i.test(source)) failures.push("reports stage has no deterministic composer fallback path");
  if (/rawResume|rawTranscript|transcriptWords/.test(source.slice(source.indexOf("candidate_report_composer"), source.indexOf("candidate_report_composer") + 2500))) failures.push("composer request contains raw resume/transcript material");
  if (!serverSource.includes("/v1/render-report-pair")) failures.push("legacy pair read/render compatibility was removed");
  assert.deepEqual(failures, []);
});
