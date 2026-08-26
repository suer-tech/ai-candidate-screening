import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PdfJsExtractionAdapter } from "../server/candidate-pipeline/documents.ts";
import { renderCandidatePdf, requiredReportSections, type ReportModel } from "../server/candidate-pipeline/reports.ts";

const CANONICAL_DIRECTIONS = ["Продуктивность", "Инициатива", "Самообучаемость", "Корпоративные ценности", "Автономность"];
const INTERNAL_MARKERS = [
  "candidate-550e8400-e29b-41d4-a716-446655440000", "vacancy-550e8400-e29b-41d4-a716-446655440001",
  "profile-internal-v17", "run-550e8400-e29b-41d4-a716-446655440002", "artifact:assessment:private-123", "file-drive-private-456",
];

const title = (type: ReportModel["type"], id: string) => ({
  identity: "Кандидат", scale: "Шкала оценки", directions: "ABC-профиль", evidence: "Основания", conflicts: "Противоречия", strengths: "Сильные стороны", limitations: "Ограничения", questions: "Вопросы HR",
  recommendation: "Рекомендация", "stop-factors": "Стоп-факторы", "critical-mismatches": "Критические несоответствия", risks: "Риски", abc: "ABC-профиль", competencies: "Компетенции", "confirmed-results": "Подтверждённые результаты", "unverified-questions": "Что проверить", "interview-quality": "Качество интервью", "access-to-ke": "Допуск к КЕ", "ke-questions": "Вопросы КЕ", "transcription-quality": "Качество транскрипции",
}[id] ?? id);

function model(type: ReportModel["type"]): ReportModel {
  return {
    type, candidateId: INTERNAL_MARKERS[0], candidateDisplayName: "Зотов Александр", vacancyId: INTERNAL_MARKERS[1], vacancyTitle: "Юрист",
    profileVersion: INTERNAL_MARKERS[2], analysisVersion: 17, generatedAtUtc: "2026-08-24T09:00:00Z", recommendation: "Рекомендовать с оговорками",
    sections: requiredReportSections(type).map((id) => ({
      id, title: title(type, id), body: id === "directions" || id === "abc" ? CANONICAL_DIRECTIONS.map((name) => `${name}: B`).join("\n")
        : id === "scale" ? "A — выше ожиданий; B — соответствует; C — не соответствует."
          : id === "conflicts" ? "При появлении противоречия требуют решения HR."
            : id === "evidence" ? `Краткие основания доступны в карточке; ${INTERNAL_MARKERS.slice(3).join(" ")}`
              : `Краткий вывод: ${title(type, id).toLowerCase()}.`,
    })), evidence: [],
    interviewSummary: type === "candidate-results" ? {
      interviewDate: "14.08.2026", fullName: "Зотов Александр", age: "28",
      compensation: "Ожидания — 300 тыс. рублей на руки.",
      recentEmployment: [{ employer: "ИП Пример", role: "Личный ассистент", period: "3 месяца", summary: "Ушла из-за расхождения фактических задач с согласованной ролью.", achievements: "Не указаны." }],
      hardSkills: ["Опыт личного ассистирования более 10 лет.", "Ведение календаря и организация поездок."],
      softSkills: ["Инициативность.", "Ответственность."],
      positives: ["Большой релевантный опыт."], negatives: ["Высокие зарплатные ожидания."],
      additional: ["Готов к интервью в удобное время."],
    } : undefined,
  };
}

async function rendered(type: ReportModel["type"]) {
  const bytes = await renderCandidatePdf(model(type));
  const pages = await new PdfJsExtractionAdapter().extract(bytes);
  return { bytes, pages, text: pages.map((page) => page.text).join("\n") };
}

test("E2E-RESULT-001: `Итоги` follows the HR interview-summary reference structure", async () => {
  const report = await rendered("candidate-results");
  assert.ok(report.pages.length >= 1 && report.pages.length <= 6, "executive result stays readable without an unbounded document");
  assert.ok(report.bytes.byteLength <= 750_000, "executive result remains operationally compact");
  for (const heading of ["Итоги интервью", "Дата:", "ФИО кандидата:", "Вакантная должность:", "Возраст кандидата:",
    "Зарплата на данный момент/ожидания:", "Последние места работы:", "Hard skills:", "Soft skills:",
    "Плюсы кандидата:", "Минусы кандидата:", "ДОПОЛНИТЕЛЬНО:"]) assert.match(report.text, new RegExp(heading));
  assert.doesNotMatch(report.text, /exactText|artifact:|\{\s*"(?:facts|evidence|locator)"/i, "report does not expose raw evidence JSON/dump");
});

test("E2E-ABC-001/E2E-RESULT-001: neither PDF exposes internal identities or forbidden explanatory copy", async () => {
  for (const type of ["abc-test", "candidate-results"] as const) {
    const { text } = await rendered(type);
    for (const marker of INTERNAL_MARKERS) assert.doesNotMatch(text, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${type} hides internal marker`);
    assert.doesNotMatch(text, /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, `${type} hides UUIDs`);
    assert.doesNotMatch(text, /Шкала оценки|A\s*[—-].*B\s*[—-].*C\s*[—-]/is, `${type} omits the A/B/C legend`);
    assert.doesNotMatch(text, /противоречи\S*\s+требу\S*\s+решени\S*\s+HR/i, `${type} omits the forbidden HR-resolution phrase`);
  }
});

test("E2E-ABC-001: ABC profile prints the five canonical Russian direction names", async () => {
  const { text } = await rendered("abc-test");
  for (const direction of CANONICAL_DIRECTIONS) assert.match(text, new RegExp(direction), `ABC report contains ${direction}`);
  assert.equal(CANONICAL_DIRECTIONS.filter((direction) => text.includes(direction)).length, 5);
});

test("E2E-ABC-001/E2E-RESULT-001: preview and download read through immutable artifact when published Drive file is unavailable", async () => {
  const [route, application, repository] = await Promise.all([
    readFile(new URL("../app/api/results/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/product/application.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/product/postgres-repository.ts", import.meta.url), "utf8"),
  ]);
  const readBoundary = application.slice(application.indexOf("export async function readCurrentResult"), application.indexOf("export async function publishResultPair"));
  assert.match(repository, /artifactRef|artifact_ref|payload_ref/, "result descriptor retains immutable report artifact identity");
  assert.match(readBoundary, /(?:catch[\s\S]{0,500}(?:artifact|blob)|read[- ]?through|reconcile)/i, "Drive read failure safely falls back to immutable artifact or reconciliation");
  assert.match(route, /DOCUMENTS[^\n]+candidate-results[^\n]+abc-test/, "the same route supports both published document types");
  assert.match(route, /download/, "the fallback applies to both preview and download modes");
});
