import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { sha256 } from "./core.ts";
import { ReportPublicationRegistry, renderCandidatePdf, renderMinimalPdf, reportFileName, requiredReportSections, validatePdf, validateRenderedReportPdf, validateReportPairModels, type ReportModel } from "./reports.ts";
import { PdfJsExtractionAdapter } from "./documents.ts";

function model(type: ReportModel["type"]): ReportModel {
  const ids = requiredReportSections(type);
  return { type, candidateId: "candidate-1", candidateDisplayName: "Кандидат", vacancyId: "vacancy-1", vacancyTitle: "Вакансия", profileVersion: "profile-1", analysisVersion: 1, generatedAtUtc: "2026-08-20T00:00:00Z", recommendation: "Рекомендовать", sections: ids.map((id) => ({ id, title: id, body: `body-${id}` })), evidence: [] };
}

test("pipeline checksum hashes binary report bytes identically to blob storage", () => {
  const bytes = new Uint8Array([0, 1, 2, 127, 128, 255]);
  assert.equal(sha256(bytes), createHash("sha256").update(bytes).digest("hex"));
});

test("two report models render to parseable checksummed PDF pair", () => {
  for (const type of ["abc-test", "candidate-results"] as const) {
    const source = model(type);
    const bytes = renderMinimalPdf(source);
    const validated = validatePdf(bytes, source);
    assert.ok(validated.size > 100);
    assert.match(reportFileName(source), /v0001\.pdf$/);
  }
});

test("Unicode Node renderer survives PDF parse and content oracle for both reports", async () => {
  const abc = model("abc-test"); const result = model("candidate-results");
  assert.equal(validateReportPairModels(abc, result), true);
  for (const source of [abc, result]) {
    const bytes = await renderCandidatePdf(source);
    const validated = await validateRenderedReportPdf(bytes, source);
    assert.ok(validated.pageCount >= 1);
  }
});

test("ABC report keeps complete compact direction explanations instead of clipping wrapped text", async () => {
  const source = model("abc-test");
  source.sections = source.sections.map((section) => section.id === "directions"
    ? { ...section, body: "• Исчерпывающая передача информации [Частично подтверждено] — Кандидат описывает передачу рыночной подборки, сметы и нескольких вариантов решения, однако отсутствует результат предусмотренной профилем проверки.\n• Второе направление [Недостаточно данных] — Нет транскрибации интервью для проверки наблюдаемого поведения." }
    : section);
  const bytes = await renderCandidatePdf(source);
  await validateRenderedReportPdf(bytes, source);
  const extracted = (await new PdfJsExtractionAdapter().extract(bytes)).map((page) => page.text).join(" ").replace(/\s+/g, " ");
  assert.match(extracted, /отсутствует результат предусмотренной профилем проверки/);
  assert.match(extracted, /Нет транскрибации интервью для проверки наблюдаемого поведения/);
});

test("publication reuses same checksums and rejects occupied version with different content atomically", () => {
  const registry = new ReportPublicationRegistry();
  const pair = (["abc-test", "candidate-results"] as const).map((type) => {
    const source = model(type); const bytes = renderMinimalPdf(source); const validation = validatePdf(bytes, source);
    return { type, bytes, checksum: validation.checksum, fileName: reportFileName(source) };
  });
  const first = registry.publishPair("candidate-1", 1, pair);
  const repeated = registry.publishPair("candidate-1", 1, pair);
  assert.deepEqual(repeated.documents.map((item) => item.driveFileId), first.documents.map((item) => item.driveFileId));
  const changed = pair.map((item, index) => {
    if (index) return item;
    const bytes = new Uint8Array([...item.bytes, 1]);
    return { ...item, bytes, checksum: sha256(bytes) };
  });
  assert.throws(() => registry.publishPair("candidate-1", 1, changed), /REPORT_VERSION_CONFLICT/);
  assert.throws(() => registry.publishPair("candidate-1", 2, [pair[0]]), /REPORT_PAIR_INCOMPLETE/);
  const secondVersion = registry.publishPair("candidate-1", 2, pair);
  assert.notDeepEqual(secondVersion.documents.map((item) => item.driveFileId), first.documents.map((item) => item.driveFileId));
  assert.deepEqual(registry.publishPair("candidate-1", 1, pair).documents.map((item) => item.driveFileId), first.documents.map((item) => item.driveFileId));
});

test("matrix workflow keeps the two-PDF contract and renders every supplied row with provenance", async () => {
  const row = { criterionId: "criterion-001", supportingClaimIds: ["claim-1"], contradictingClaimIds: [], checkedSourceIds: ["source-1"], state: "Подтверждено" as const, reason: "Есть проверяемый пример", missingData: "", followUpQuestion: "", verificationState: "VERIFIED" as const };
  const pair = (["abc-test", "candidate-results"] as const).map((type) => ({ ...model(type), workflowVersion: "matrix-v1", matrixProvenance: { matrixId: "matrix-1", checksum: "a".repeat(64), policyVersion: "policy-v1" }, matrixRows: [row], sections: [...model(type).sections, { id: "matrix", title: "Матрица критериев", body: "matrix-1" }, { id: "matrix:criterion-001", title: "criterion-001", body: "Подтверждено — Есть проверяемый пример" }] }));
  assert.equal(validateReportPairModels(pair[0], pair[1]), true);
  for (const source of pair) await validateRenderedReportPdf(await renderCandidatePdf(source), source);
  assert.throws(() => renderMinimalPdf({ ...pair[0], matrixRows: [] }), /REPORT_MATRIX_PROJECTION_MISSING/);
});
