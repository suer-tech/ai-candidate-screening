import assert from "node:assert/strict";
import test from "node:test";
import { PdfJsExtractionAdapter } from "../server/candidate-pipeline/documents.ts";
import { composeCandidateReportFailSoft, renderCandidatePdf, reportSectionTitle, requiredReportSections, validateReportModel, type ReportModel } from "../server/candidate-pipeline/reports.ts";

const ordered = ["identity", "sources", "organizational-conditions", "review", "key-evidence", "abc-directions", "technical-check", "motivation-fit", "risks", "decision", "final-summary"] as const;
const titles: Record<(typeof ordered)[number], string> = {
  identity: "Кандидат и вакансия", sources: "Исходные материалы", "organizational-conditions": "Организационные моменты",
  review: "Ревью", "key-evidence": "Ключевые доказательства", "abc-directions": "ABC по направлениям",
  "technical-check": "Технический чек", "motivation-fit": "Мотивация и соответствие роли", risks: "Риски",
  decision: "Решение", "final-summary": "Финальное HR-резюме",
};
const recommendation = "Рекомендовать с оговорками" as const;
const matrixRows = [{ criterionId: "criterion-internal-1", state: "Соответствует", conclusion: "Внутренняя полная строка", reason: "audit only", supportingClaimIds: ["claim-internal-1"], contradictingClaimIds: [], checkedSourceIds: ["resume:2"], missingData: "", followUpQuestion: "", verificationState: "NOT_REQUIRED", evidence: [{ evidenceId: "evidence-1" }] }] as never;

function compactSections() {
  const body: Record<string, string> = {
    identity: "Синтетический кандидат — ассистент.", sources: "Резюме и интервью.", "organizational-conditions": "Готовность к офисному формату.",
    review: "Организует встречи заранее и передаёт полный контекст.", "key-evidence": "Готовил материалы за день до встречи. Источник: Резюме, стр. 2.",
    "abc-directions": "Продуктивность — B; Автономность — A.", "technical-check": "Инструменты\nРаботал с календарём. Источник: Интервью, 00:14.\nДокументы\nГотовил протоколы. Источник: Резюме, стр. 2.",
    "motivation-fit": "Роль соответствует ожиданиям кандидата.", risks: "Нужно уточнить объём полномочий.", decision: recommendation,
    "final-summary": "HR может переходить к следующему интервью после уточнения полномочий.",
  };
  return ordered.map((id) => ({ id, title: titles[id], body: body[id] }));
}

test("TST-126: candidate-report registry is exactly the compact eleven sections in normative order", () => {
  const actual = requiredReportSections("candidate-report");
  const failures: string[] = [];
  if (JSON.stringify(actual) !== JSON.stringify(ordered)) failures.push(`section order/count mismatch: ${JSON.stringify(actual)}`);
  for (const id of ordered) if (reportSectionTitle("candidate-report", id) !== titles[id]) failures.push(`${id}: title=${reportSectionTitle("candidate-report", id)}`);
  for (const forbidden of ["vacancy-criteria", "matrix", "stop-factors", "questions", "strengths", "recommendation", "executive-summary"]) if (actual.includes(forbidden)) failures.push(`standalone forbidden section remains: ${forbidden}`);
  assert.deepEqual(failures, []);
});

test("REP-023: full matrixRows remain in model/audit but compact model does not require visible matrix sections", () => {
  const model = { type: "candidate-report", candidateId: "synthetic", candidateDisplayName: "Synthetic Candidate", vacancyId: "vacancy", vacancyTitle: "Assistant", profileVersion: "profile-v1",
    analysisVersion: 1, generatedAtUtc: "2026-08-27T00:00:00Z", recommendation, workflowVersion: "matrix-v3", matrixProvenance: { matrixId: "matrix-audit", checksum: "checksum" },
    matrixRows, decisionSnapshot: { recommendation, matrixRows }, evidenceCatalog: [{ evidenceId: "evidence-1", quote: "Готовил материалы", source: "Резюме, стр. 2" }], sections: compactSections(), evidence: [] } as unknown as ReportModel;
  assert.equal(model.matrixRows?.length, 1, "audit model lost full rows");
  assert.equal(validateReportModel(model), true, "compact PDF must not require matrix or matrix:criterion sections");
});

test("REP-023: composer preserves evidence-backed technical subheadings and removes review/decision/final duplication", async () => {
  const repeated = "Одинаковый вывод не должен повторяться.";
  const decisionSnapshot = { recommendation, abcGrades: { productivity: "B" }, matrixRows };
  const result = await composeCandidateReportFailSoft({ decisionSnapshot, evidenceCatalog: [{ evidenceId: "evidence-1", quote: "Работал с календарём", source: "Интервью, 00:14" }], composer: async () => ({ decisionSnapshot,
    sections: ordered.map((sectionId) => ({ sectionId, statements: sectionId === "technical-check"
      ? [{ text: "Инструменты — работал с календарём", evidenceIds: ["evidence-1"] }, { text: "Документы — готовил протоколы", evidenceIds: ["evidence-1"] }]
      : [{ text: ["review", "decision", "final-summary"].includes(sectionId) ? repeated : `Содержание ${sectionId}`, evidenceIds: ["evidence-1"] }] })) }) });
  const actualIds = result.model.sections.map((section) => section.sectionId);
  assert.deepEqual(actualIds, [...ordered]);
  const technical = result.model.sections.find((section) => section.sectionId === "technical-check");
  assert.deepEqual(technical?.statements.map((item) => item.text), ["Инструменты — работал с календарём", "Документы — готовил протоколы"]);
  assert.ok(technical?.statements.every((item) => item.evidenceIds.includes("evidence-1")));
  assert.equal((JSON.stringify(result.model).match(new RegExp(repeated, "g")) ?? []).length, 1);
  assert.deepEqual(result.model.decisionSnapshot, decisionSnapshot);
});

test("REP-023: rendered PDF has eleven ordered HR sections, recommendation only in Decision, no matrix appendix/callout", async () => {
  const model = { type: "candidate-report", candidateId: "synthetic", candidateDisplayName: "Synthetic Candidate", vacancyId: "vacancy", vacancyTitle: "Assistant", profileVersion: "profile-v1",
    analysisVersion: 1, generatedAtUtc: "2026-08-27T00:00:00Z", recommendation, workflowVersion: "matrix-v3", matrixProvenance: { matrixId: "matrix-audit", checksum: "checksum" }, matrixRows,
    decisionSnapshot: { recommendation, matrixRows }, evidenceCatalog: [{ evidenceId: "evidence-1", quote: "Готовил материалы", source: "Резюме, стр. 2" }], sections: compactSections(), evidence: [] } as unknown as ReportModel;
  let text = "";
  try { text = (await new PdfJsExtractionAdapter().extract(await renderCandidatePdf(model))).map((page) => page.text).join(" ").replace(/\s+/g, " "); }
  catch (error) { assert.fail(`compact candidate-report rejected by renderer: ${String(error)}`); }
  let cursor = -1;
  for (const id of ordered) { const next = text.indexOf(titles[id], cursor + 1); assert.ok(next > cursor, `${titles[id]} missing or out of order`); cursor = next; }
  assert.equal((text.match(new RegExp(recommendation, "g")) ?? []).length, 1, "recommendation must appear only in Решение");
  for (const forbidden of ["Критерии вакансии", "Матрица оценки", "Стоп-факторы", "Вопросы для уточнения", "criterion-internal-1", "Внутренняя полная строка", "Рекомендация"]) assert.equal(text.includes(forbidden), false, `PDF exposes forbidden content: ${forbidden}`);
  assert.ok(text.includes("Инструменты") && text.includes("Источник: Интервью, 00:14"), "technical check lost evidence-backed subheading/source");
  assert.equal(text.includes(compactSections().find((section) => section.id === "review")!.body), true);
  assert.equal(text.includes(compactSections().find((section) => section.id === "final-summary")!.body), true);
});
