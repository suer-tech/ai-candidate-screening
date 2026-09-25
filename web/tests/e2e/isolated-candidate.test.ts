import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { classifyMaterials } from "../../server/candidate-pipeline/core.ts";
import { PdfJsExtractionAdapter } from "../../server/candidate-pipeline/documents.ts";
import { parseReadyTranscript } from "../../server/candidate-pipeline/transcription.ts";
import { canonicalizeVacancyMatrix, validateCandidateMatrixRows, type CandidateMatrixRow, type CandidateSourceClaim } from "../../server/candidate-pipeline/matrix-driven.ts";
import { renderMinimalPdf, requiredReportSections, type ReportModel } from "../../server/candidate-pipeline/reports.ts";
import { executeCandidateTool, type ProductionRuntime } from "../../server/candidate-pipeline/tool-executor.ts";

test("isolated candidate path produces a grounded PDF without Drive or Telegram writes", async () => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage().drawText("I organized weekly meetings and tracked follow-up actions.", { x: 30, y: 700, font });
  const resume = new Uint8Array(await document.save());
  const objects = [
    { fileId: "synthetic-resume", parentFolderId: "isolated-folder", version: "1", name: "resume.pdf", mimeType: "application/pdf", size: resume.length, modifiedTime: "2026-09-25T00:00:00Z" },
    { fileId: "synthetic-transcript", parentFolderId: "isolated-folder", version: "1", name: "Стенограмма интервью.txt", mimeType: "text/plain", size: 120, modifiedTime: "2026-09-25T00:00:00Z" },
  ];
  const manifest = classifyMaterials(objects);
  assert.equal(manifest.complete, true);
  assert.equal(manifest.entries.find((entry) => entry.fileId === "synthetic-transcript")?.interviewSource, "ready-transcript");

  const pages = await new PdfJsExtractionAdapter().extract(resume);
  assert.match(pages[0].text, /organized weekly meetings/);
  const transcript = parseReadyTranscript({ fileId: "synthetic-transcript", fileVersion: "1", fileName: "Стенограмма интервью.txt", mimeType: "text/plain",
    extractedText: "Интервьюер: Расскажите о встречах.\nКандидат: Я составлял повестку и отслеживал договорённости." });
  assert.equal(transcript.utterances.length, 2);

  const sourceText = "Организует встречи и отслеживает договорённости";
  const matrix = canonicalizeVacancyMatrix({ profileVersion: "synthetic-profile-v1", compilerPolicyVersion: "synthetic-policy-v1", skillVersions: { compiler: "controlled-synthetic" },
    sourceFragments: { "profile.competencies.meetings": sourceText }, criteria: [{ temporaryId: "meetings", sourceRefs: ["profile.competencies.meetings"], sourceText,
      interpretation: sourceText, category: "competency", required: true, requiredExplanation: "Требование тестовой вакансии", hardRequired: false,
      operator: "ALL_OF", evaluationRule: "Найти личный пример", expectedEvidence: ["resume", "transcript"],
      allowedStates: ["Соответствует", "Недостаточно данных"], decisionEffect: "required-gap", missingDataQuestion: "Как организовывали встречи?", interpretationNotes: [] }] });
  const criterionId = matrix.criteria[0].criterionId;
  const claim: CandidateSourceClaim = { claimId: "synthetic-claim-1", candidateId: "synthetic-candidate", runId: "synthetic-run", inputVersion: "synthetic-input-v1", profileVersion: matrix.profileVersion,
    author: "Synthetic Candidate", role: "candidate", text: pages[0].text, locator: "resume:page-1", provenanceRef: "synthetic-local-pdf", criterionIds: [criterionId],
    sourceClass: "resume", directness: "direct", relation: "SUPPORTS" };
  const row: CandidateMatrixRow = { criterionId, supportingClaimIds: [claim.claimId], contradictingClaimIds: [], checkedSourceIds: ["synthetic-resume", "synthetic-transcript"],
    state: "Соответствует", reason: "Личный пример указан в резюме", missingData: "", followUpQuestion: "", verificationState: "NOT_REQUIRED",
    evidence: [{ claimId: claim.claimId, sourceRef: claim.locator, quote: "organized weekly meetings", relation: "SUPPORTS", explanation: "Прямой пример организации встреч" }] };
  assert.deepEqual(validateCandidateMatrixRows([criterionId], [], [claim]).missingCriterionIds, [criterionId]);
  assert.equal(validateCandidateMatrixRows([criterionId], [row], [claim]).decision, "PASS");

  const report: ReportModel = { type: "candidate-report", candidateId: claim.candidateId, candidateDisplayName: "Synthetic Candidate", vacancyId: "synthetic-vacancy",
    vacancyTitle: "Бизнес-ассистент", profileVersion: matrix.profileVersion, analysisVersion: 1, generatedAtUtc: "2026-09-25T00:00:00Z", recommendation: "Рекомендовать",
    matrixRows: [row], matrixProvenance: { matrixId: "synthetic-matrix", checksum: matrix.checksum },
    sections: requiredReportSections("candidate-report").map((id) => ({ id, title: id, body: id === "key-evidence" ? claim.text : `Synthetic ${id}` })), evidence: [] };
  const pdf = renderMinimalPdf(report);
  const renderedPages = await new PdfJsExtractionAdapter().extract(pdf);
  assert.match(renderedPages[0].text, /candidate=synthetic-candidate/);
  assert.match(renderedPages[0].text, /key-evidence/);

  const recorded: string[] = [];
  const forbidden = async () => { throw new Error("ISOLATED_EXTERNAL_WRITE_ATTEMPTED"); };
  const runtime: ProductionRuntime = {
    repository: { async assertGrant() { return true; }, async checkpoint(value) { recorded.push(`checkpoint:${value.kind}`); },
      async artifactReference(value) { recorded.push(`artifact:${value.artifactRef}`); }, async outboxIntent() { await forbidden(); }, async waitForHuman() { await forbidden(); } },
    oauth: { async accessToken() { await forbidden(); return ""; } },
    adapters: { drive: { async snapshot() { await forbidden(); return { folderId: "", objects: [] }; }, async publishPdf() { await forbidden(); return {}; }, async reconcile() { await forbidden(); return null; } },
      routerAI: { async invoke() { await forbidden(); return { artifactRef: "" }; } }, assemblyAI: { async create() { await forbidden(); return { remoteJobId: "" }; }, async poll() { await forbidden(); return {}; } },
      pdf: { async render() { return { type: "candidate-report", checksum: createHash("sha256").update(pdf).digest("hex"), artifactRef: "artifact:isolated-report" }; } },
      telegram: { async send() { await forbidden(); } }, validation: { async validate() { return { artifactRef: "artifact:isolated-validation" }; } } },
  };
  const environmentBindings = { CANDIDATE_PIPELINE_ROUTING: "effectful", AGENT_RUNTIME_INTERNAL_TOKEN: "synthetic", AGENT_RUNTIME_CONFIG_JSON: "{}",
    GOOGLE_OAUTH_CLIENT_ID: "synthetic", GOOGLE_OAUTH_CLIENT_SECRET: "synthetic", GOOGLE_OAUTH_REDIRECT_URI: "http://localhost/callback", GOOGLE_OAUTH_DEPLOYMENT_MODE: "production",
    GOOGLE_OAUTH_TOKEN_KEYRING_JSON: "{}", LLM_RUNTIME_CONFIG_JSON: "{}", ROUTERAI_API_KEY: "synthetic", ASSEMBLYAI_API_KEY: "synthetic",
    TELEGRAM_BOT_TOKEN: "synthetic", TELEGRAM_RECIPIENT_REFS_JSON: "{}" };
  const task = { id: "synthetic-task", idempotencyIdentity: "synthetic-run:report", authorizationGrantId: "synthetic-grant", inputVersion: claim.inputVersion, profileVersion: matrix.profileVersion };
  assert.equal((await executeCandidateTool({ toolKey: "candidate.validation/v1", task, environmentBindings, runtime })).outcome, "SUCCEEDED");
  assert.equal((await executeCandidateTool({ toolKey: "candidate.report/v1", task, environmentBindings, runtime })).outcome, "SUCCEEDED");
  assert.deepEqual(recorded, ["artifact:artifact:isolated-validation", "checkpoint:validated-assessment", "artifact:artifact:isolated-report", "checkpoint:candidate-report"]);
});
