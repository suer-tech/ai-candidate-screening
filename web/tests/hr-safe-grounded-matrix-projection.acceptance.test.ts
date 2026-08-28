import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { validateCandidateMatrixRows, type CandidateMatrixRow, type CandidateSourceClaim } from "../server/candidate-pipeline/matrix-driven.ts";
import { renderCandidatePdf, requiredReportSections, type ReportModel } from "../server/candidate-pipeline/reports.ts";
import { PdfJsExtractionAdapter } from "../server/candidate-pipeline/documents.ts";
import { projectAssessment } from "../server/product/postgres-repository.ts";

const claim: CandidateSourceClaim = {
  claimId: "claim-role-1", candidateId: "synthetic-candidate", runId: "synthetic-run", inputVersion: "input-v1", profileVersion: "profile-v1",
  author: "Синтетический кандидат", role: "candidate", roleConfidence: 0.99,
  text: "Я заранее готовил встречи и отправлял участникам полный контекст.", locator: "resume:page:2", provenanceRef: "protected-trace-1",
  criterionIds: ["criterion-role"], sourceClass: "resume", directness: "direct", relation: "SUPPORTS",
};

function row(state: CandidateMatrixRow["state"], overrides: Record<string, unknown> = {}) {
  return {
    criterionId: "criterion-role", supportingClaimIds: state === "Соответствует" ? [claim.claimId] : [], contradictingClaimIds: [], checkedSourceIds: [claim.locator],
    state, reason: "Кандидат описал релевантный опыт.", missingData: "", followUpQuestion: "", verificationState: "NOT_REQUIRED",
    evidence: state === "Недостаточно данных" ? [] : [{ claimId: claim.claimId, sourceRef: claim.locator, quote: "заранее готовил встречи", relation: "SUPPORTS", explanation: "Прямой пример по критерию" }],
    ...overrides,
  } as CandidateMatrixRow & { evidence: unknown[] };
}

function validate(rows: readonly CandidateMatrixRow[]) {
  return (validateCandidateMatrixRows as unknown as (ids: readonly string[], rows: readonly CandidateMatrixRow[], claims: readonly CandidateSourceClaim[]) => { decision: string })(["criterion-role"], rows, [claim]);
}

test("MDA-010: row acceptance resolves exact claim/source/quote and rejects ungrounded verdicts", () => {
  const failures: string[] = [];
  if (validate([row("Соответствует")]).decision !== "PASS") failures.push("exact grounded positive row was rejected");
  if (validate([row("Соответствует", { evidence: [], supportingClaimIds: [] })]).decision !== "REJECTED") failures.push("positive row without evidence was accepted");
  if (validate([row("Не соответствует", { evidence: [], contradictingClaimIds: [] })]).decision !== "REJECTED") failures.push("negative row without evidence was accepted");
  if (validate([row("Соответствует", { evidence: [{ claimId: "claim-invented", sourceRef: claim.locator, quote: "заранее готовил встречи", relation: "SUPPORTS", explanation: "invented id" }] })]).decision !== "REJECTED") failures.push("invented claimId was accepted");
  if (validate([row("Соответствует", { evidence: [{ claimId: claim.claimId, sourceRef: "candidate:///invented", quote: "заранее готовил встречи", relation: "SUPPORTS", explanation: "invented ref" }] })]).decision !== "REJECTED") failures.push("invented sourceRef was accepted");
  if (validate([row("Соответствует", { evidence: [{ claimId: claim.claimId, sourceRef: claim.locator, quote: "invented quote", relation: "SUPPORTS", explanation: "invented quote" }] })]).decision !== "REJECTED") failures.push("invented quote was accepted");
  if (validate([row("Недостаточно данных", { evidence: [], missingData: "", followUpQuestion: "" })]).decision !== "REJECTED") failures.push("empty insufficient row without missingData and follow-up was accepted");
  if (validate([row("Недостаточно данных", { evidence: [], missingData: "Нужен пример проекта", followUpQuestion: "Приведите пример подготовки встречи." })]).decision !== "PASS") failures.push("well-formed insufficient row was rejected");
  assert.deepEqual(failures, []);
});

const claimsRef = "candidate:///synthetic-run/artifact/matrix-claims";
const claimsArtifact = {
  schemaVersion: "matrix-claims/v2",
  claims: [claim, { ...claim, claimId: "claim-risk-1", text: "Иногда получал контекст только после встречи.", locator: "interview:utterance:7", relation: "CONTRADICTS" }],
};
const snapshot = {
  recommendation: "Рекомендовать с оговорками",
  structuredAssessment: {
    matrixCriteria: { "criterion-role": { sourceText: "Заранее готовит встречи", category: "competency" }, "criterion-risk": { sourceText: "Работает с полным контекстом", category: "result" } },
    matrixRows: [row("Соответствует"), { ...row("Не соответствует"), criterionId: "criterion-risk", contradictingClaimIds: ["claim-risk-1"], evidence: [{ claimId: "claim-risk-1", sourceRef: "interview:utterance:7", quote: "контекст только после встречи", relation: "CONTRADICTS", explanation: "Прямое ограничение" }] }],
    competencies: [{ name: "Организация встреч", state: "Подтверждено", reason: "Есть точный пример", factIds: [claim.claimId] }],
    risks: [{ name: "Поздний контекст", state: "Не подтверждено", reason: "Есть противоречащий пример", factIds: ["claim-risk-1"] }],
    abcStates: { "criterion-001": "A" }, abcEvidence: {}, observations: [], stopFactors: [], accessToKe: [],
  },
};

test("REP-022: dashboard resolves claimsRef and exposes every row with human evidence, without internal IDs", () => {
  const overview = projectAssessment(snapshot, { schemaVersion: "matrix-evidence/v2", claimsRef, resolvedArtifacts: { [claimsRef]: claimsArtifact } });
  const rendered = JSON.stringify(overview);
  const failures: string[] = [];
  if ((overview?.evidence.length ?? 0) !== 2) failures.push(`expected evidence for both rows through claimsRef, actual=${overview?.evidence.length ?? 0}`);
  if (!rendered.includes("заранее готовил встречи") || !rendered.includes("контекст только после встречи")) failures.push("human quotes from separate claims artifact are missing");
  if (!rendered.includes("Резюме") || !rendered.includes("Интервью")) failures.push("human-readable source locations are missing");
  for (const forbidden of ["claim-role-1", "claim-risk-1", "criterion-role", "criterion-risk", "candidate:///", "matrix-claims/v2"]) if (rendered.includes(forbidden)) failures.push(`dashboard leaks ${forbidden}`);
  assert.deepEqual(failures, []);
});

test("MDA-011: vacancy ABC directions are evaluated even when optional A/B/C descriptions are empty", async () => {
  const overview = projectAssessment(snapshot, { facts: [] });
  const configured = projectAssessment(snapshot, { facts: [] }, undefined, { abcDirections: [{ id: "productivity", name: "Продуктивность", gradeA: "", gradeB: "", gradeC: "" }] });
  const runtimeSource = await readFile(new URL("../server/candidate-pipeline/production-runtime.ts", import.meta.url), "utf8");
  const rowsStage = runtimeSource.slice(runtimeSource.indexOf('if (toolKey === "candidate.matrix-rows/v1")'), runtimeSource.indexOf('if (toolKey === "candidate.matrix-verify/v1")'));
  const failures: string[] = [];
  if (overview?.abc.some((item) => /criterion-\d+/i.test(item.direction))) failures.push("technical main-matrix criterion was projected as ABC direction");
  if (!overview?.abc.some((item) => /не настроен/i.test(`${item.direction} ${item.reason ?? ""}`))) failures.push("dashboard does not explicitly say ABC is not configured");
  if (configured?.abcConfigured !== true || configured.abc[0]?.direction !== "Продуктивность") failures.push("direction with empty optional level descriptions is treated as not configured");
  if (!/availableAbcDirections/.test(rowsStage) || /completeAbcDirections/.test(rowsStage)) failures.push("rows stage still requires complete A/B/C descriptions");
  if (!/inferMissingLevelDefinitions:\s*true/.test(rowsStage) || !/insufficientOnlyWhenNoRelevantCandidateEvidence:\s*true/.test(rowsStage)) failures.push("rows stage does not request fallback ABC evaluation");
  assert.deepEqual(failures, []);
});

test("REP-022: both PDF models contain human quote/location and no runtime identifiers or verifier prose", async () => {
  const forbidden = ["claim-role-1", "criterion-role", "artifactId", "candidate:///", "matrix-claims/v2", "candidate-policy-v1", "Проверяющий отметил"];
  const failures: string[] = [];
  for (const type of ["abc-test", "candidate-results"] as const) {
    const sections = requiredReportSections(type).map((id) => ({ id, title: id, body: "Human-readable evidence: Resume, page 2 — prepared meetings in advance." }));
    sections.push({ id: "matrix", title: "Matrix", body: "claim-role-1 criterion-role artifactId candidate:/// matrix-claims/v2 candidate-policy-v1 Проверяющий отметил" });
    sections.push({ id: "matrix:criterion-role", title: "Role", body: "Human-readable evidence: Resume, page 2 — prepared meetings in advance. claim-role-1" });
    const model = { type, candidateId: "synthetic", candidateDisplayName: "Synthetic", vacancyId: "vacancy", vacancyTitle: "Assistant", profileVersion: "profile-v1", analysisVersion: 1,
      generatedAtUtc: "2026-08-27T00:00:00Z", recommendation: "Рекомендовать с оговорками", workflowVersion: "matrix-v3",
      matrixProvenance: { matrixId: "internal-matrix-id", checksum: "checksum", policyVersion: "candidate-policy-v1" }, matrixRows: [row("Соответствует")], sections, evidence: [] } as ReportModel;
    const pages = await new PdfJsExtractionAdapter().extract(await renderCandidatePdf(model));
    const pdfText = pages.map((page) => page.text).join(" ");
    if (!/Human-readable evidence: Resume, page 2/.test(pdfText)) failures.push(`${type} lost human quote/location`);
    for (const token of forbidden) if (new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(pdfText)) failures.push(`${type} leaked ${token}`);
  }
  assert.deepEqual(failures, []);
});

test("REP-022: derived strengths, competencies and risks require displayable evidence", () => {
  const unsupported = projectAssessment(snapshot, { facts: [] });
  const failures: string[] = [];
  if (unsupported?.strengths.length) failures.push("strength was derived without displayable evidence");
  if (unsupported?.competencies.length) failures.push("competency was derived without displayable evidence");
  if (unsupported?.risks.length) failures.push("risk was derived without displayable evidence");
  assert.deepEqual(failures, []);
});
