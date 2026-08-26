import assert from "node:assert/strict";
import test from "node:test";
import { projectCandidate } from "../server/candidate-pipeline/dashboard-projection.ts";
import { PdfJsExtractionAdapter } from "../server/candidate-pipeline/documents.ts";
import { renderCandidatePdf, requiredReportSections, validateRenderedReportPdf, validateReportPairModels, type ReportModel } from "../server/candidate-pipeline/reports.ts";
import type { CandidateRecord } from "../app/product-model.ts";
import type { EvidenceFact } from "../server/candidate-pipeline/types.ts";

const candidate: CandidateRecord = {
  id: "candidate-zotov", name: "Зотов Александр", initials: "ЗА", vacancyId: "vacancy-lawyer", vacancy: "Юрист",
  status: "ANALYZING", archived: false, stageStartedAt: "2026-08-24T06:00:00Z", elapsedMinutes: 22, etaMinutes: null, result: null,
};

const assessment = {
  id: "assessment-rich-1",
  recommendation: "Рекомендовать с оговорками",
  recommendationBasis: "Профиль подтверждён, но требуется проверка автономности.",
  stopFactors: [{ name: "Нарушение конфиденциальности", state: "Не подтверждено", factIds: ["fact-1"] }],
  abc: [{ direction: "Продуктивность", grade: "A", factIds: ["fact-1"] }],
  competencies: [{ name: "Договорная работа", state: "Подтверждено", factIds: ["fact-1"] }],
  risks: [{ name: "Недостаток судебной практики", factIds: ["fact-2"] }],
  accessToKe: [{ name: "Проверка КЕ", state: "Подтверждено", factIds: ["fact-1"] }],
  evidence: [
    { id: "fact-1", label: "Подтверждённый опыт", source: "Резюме, стр. 1" },
    { id: "fact-2", label: "Требует проверки", source: "Интервью 00:12:30" },
  ],
};

test("E2E-RESULT-001 regression: READY detail projects the structured assessment into AI overview", () => {
  const projected = projectCandidate(candidate, [], {
    runId: "run-ready-1",
    analysisVersion: 1,
    completedAt: "2026-08-24T06:22:00Z",
    recommendation: assessment.recommendation,
    assessment,
    documents: [
      { id: "result", type: "candidate-results", fileName: "Итоги.pdf", driveFileId: "drive-result" },
      { id: "abc", type: "abc-test", fileName: "ABC.pdf", driveFileId: "drive-abc" },
    ],
  } as Parameters<typeof projectCandidate>[2] & { assessment: typeof assessment });

  assert.equal(projected.status, "READY");
  assert.equal(projected.result?.recommendation, assessment.recommendation);
  assert.notEqual(projected.result?.summary, "Недостаточно данных для прогноза", "ETA fallback is never presented as an analysis result");
  const overview = (projected.result as unknown as { aiOverview?: typeof assessment })?.aiOverview;
  assert.ok(overview, "READY result exposes a structured AI overview, not only generic publication text");
  assert.equal(overview.recommendationBasis, assessment.recommendationBasis);
  for (const key of ["stopFactors", "abc", "competencies", "risks", "accessToKe", "evidence"] as const) {
    assert.ok(overview[key].length > 0, `${key} is projected from the immutable assessment snapshot`);
  }
});

function evidenceFact(exactText: string): EvidenceFact {
  return {
    id: "fact-oversized", predicate: "experience", value: "confirmed", confidence: 0.95, sourceType: "resume",
    locator: { kind: "document", fileId: "resume", fileVersion: "1", artifactId: "artifact-1", fileName: "resume.pdf", page: 1, section: "Опыт", exactText },
  };
}

const TITLES: Record<ReportModel["type"], Record<string, string>> = {
  "abc-test": { identity: "Кандидат", scale: "Шкала оценки", directions: "ABC-профиль", evidence: "Основания", conflicts: "Противоречия", strengths: "Сильные стороны", limitations: "Ограничения", questions: "Вопросы HR" },
  "candidate-results": { identity: "Кандидат", recommendation: "Рекомендация", "stop-factors": "Стоп-факторы", "critical-mismatches": "Критические несоответствия", strengths: "Сильные стороны", limitations: "Ограничения", risks: "Риски", abc: "ABC-профиль", competencies: "Компетенции", "confirmed-results": "Подтверждённые результаты", conflicts: "Противоречия", "unverified-questions": "Что проверить", "interview-quality": "Качество интервью", "access-to-ke": "Допуск к КЕ", "ke-questions": "Вопросы КЕ", "transcription-quality": "Качество транскрипции", evidence: "Основания" },
};

const CANONICAL_ABC_DIRECTIONS = ["Продуктивность", "Инициатива", "Самообучаемость", "Корпоративные ценности", "Автономность"];
const EXECUTIVE_VISIBLE_TITLES: Record<ReportModel["type"], readonly string[]> = {
  "abc-test": ["ABC-профиль", "Сильные стороны", "Ограничения", "Вопросы HR"],
  "candidate-results": ["Итоги интервью", "Последние места работы", "Hard skills", "Soft skills", "Плюсы кандидата", "Минусы кандидата", "ДОПОЛНИТЕЛЬНО"],
};

function report(type: ReportModel["type"], exactText: string): ReportModel {
  return {
    type, candidateId: "candidate-zotov", candidateDisplayName: "Зотов Александр", vacancyId: "vacancy-lawyer", vacancyTitle: "Юрист",
    profileVersion: "profile-1", analysisVersion: 1, generatedAtUtc: "2026-08-24T06:22:00Z", recommendation: "Рекомендовать с оговорками",
    sections: requiredReportSections(type).map((id) => ({ id, title: TITLES[type][id], body: id === "directions" || id === "abc"
      ? CANONICAL_ABC_DIRECTIONS.map((direction) => `${direction}: B`).join("\n")
      : id === "evidence" ? "2 проверенных основания; подробности доступны в карточке кандидата." : `Краткий вывод по разделу «${TITLES[type][id]}».` })),
    evidence: [evidenceFact(exactText)],
    interviewSummary: type === "candidate-results" ? {
      interviewDate: "14.08.2026", fullName: "Зотов Александр", age: "28", compensation: "300 тыс. рублей на руки.",
      recentEmployment: [{ employer: "ИП Пример", role: "Личный ассистент", period: "3 месяца", summary: "Роль не совпала с согласованным форматом.", achievements: "Не указаны." }],
      hardSkills: ["Опыт личного ассистирования более 10 лет.", "Организация поездок и ведение календаря."],
      softSkills: ["Ответственность.", "Инициативность."], positives: ["Релевантный опыт."],
      negatives: ["Зарплатные ожидания."], additional: ["Готов к следующему интервью."],
    } : undefined,
  };
}

test("E2E-ABC-001/E2E-RESULT-001 regression: oversized evidence still produces exactly two readable PDFs", async () => {
  const dumpMarker = "RAW_EVIDENCE_DUMP_TOKEN";
  const oversizedExactText = `${dumpMarker} ${"Подробная дословная расшифровка доказательства. ".repeat(5000)}`;
  const abc = report("abc-test", oversizedExactText);
  const result = report("candidate-results", oversizedExactText);
  assert.equal(validateReportPairModels(abc, result), true, "the publication model is exactly the ABC and final-result pair");

  for (const model of [abc, result]) {
    const bytes = await renderCandidatePdf(model);
    const pages = await new PdfJsExtractionAdapter().extract(bytes);
    const text = pages.map((page) => page.text).join("\n");
    assert.ok(pages.length >= 1 && pages.length <= 6, `${model.type} uses as many pages as needed for readable type without becoming unbounded`);
    assert.ok(bytes.byteLength <= 750_000, `${model.type} stays operationally compact`);
    assert.doesNotMatch(text, new RegExp(dumpMarker), "raw evidence exactText/JSON is not dumped into the HR report");
    for (const title of EXECUTIVE_VISIBLE_TITLES[model.type]) assert.match(text, new RegExp(title), `executive section remains readable: ${title}`);
    assert.doesNotMatch(text, /Шкала оценки|A\s*[—-].*B\s*[—-].*C\s*[—-]/is, "ABC scale legend is not visually rendered");
    if (model.type === "abc-test") for (const direction of CANONICAL_ABC_DIRECTIONS) assert.match(text, new RegExp(direction), `ABC executive view contains ${direction}`);
    try {
      await validateRenderedReportPdf(bytes, model);
    } catch (error) {
      const code = error instanceof Error ? error.message.split(":", 1)[0] : "UNKNOWN_ERROR";
      assert.fail(`content oracle must accept compact evidence references without raw exactText; actual=${code}`);
    }
  }
});
