import assert from "node:assert/strict";
import test from "node:test";
import { PdfJsExtractionAdapter } from "../server/candidate-pipeline/documents.ts";
import { renderCandidatePdf, validateRenderedReportPdf, type ReportModel } from "../server/candidate-pipeline/reports.ts";

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

const directions = Array.from({ length: 7 }, (_, index) => {
  const number = index + 1;
  return `Направление ${number} — Синтетическая компетенция ${number}: B — Кандидат подробно описал завершённый результат ${number}, `
    + `объяснил исходную ситуацию, собственные действия и измеримый эффект без сокращения исходной формулировки. `
    + `Причина оценки ${number}: наблюдаемое поведение подтверждено точным фрагментом контрольного документа. `
    + `КОНЕЦ-НАПРАВЛЕНИЯ-${number}.`;
});

const evidenceLocators = Array.from({ length: 10 }, (_, index) => {
  const number = index + 1;
  return `Основание ${number}: имя файла «синтетическое-резюме-${number}.pdf»; ID документа: DOC-EVIDENCE-${String(number).padStart(3, "0")}; `
    + `версия файла: ${20 + number}; точный фрагмент: «Кандидат самостоятельно завершил контрольный результат ${number} `
    + `и сообщил измеримый эффект без домысливания»; страница: ${number}; раздел: «Контрольные результаты»; `
    + `КОНЕЦ-ЛОКАТОРА-${number}.`;
});

const sectionBodies: Record<string, string> = {
  identity: "Идентификатор карточки: SYNTHETIC-CANDIDATE-ABC; версия профиля: PROFILE-VERSION-0042; версия анализа: v0007; КОНЕЦ-ИДЕНТИЧНОСТИ.",
  scale: "A — выше ожиданий; B — соответствует ожиданиям; C — ниже ожиданий; Недостаточно данных — оценка не присваивается; КОНЕЦ-ШКАЛЫ.",
  directions: directions.join("\n"),
  evidence: evidenceLocators.join("\n"),
  conflicts: "Противоречие 1: в резюме и интервью указаны разные сроки проекта; оба точных утверждения сохранены, вывод не подменён; КОНЕЦ-ПРОТИВОРЕЧИЙ.",
  strengths: Array.from({ length: 6 }, (_, index) => `Сильная сторона ${index + 1}: полный подтверждённый результат с наблюдаемым эффектом; КОНЕЦ-СИЛЬНОЙ-СТОРОНЫ-${index + 1}.`).join("\n"),
  limitations: Array.from({ length: 6 }, (_, index) => `Ограничение ${index + 1}: полная причина ограничения и явно обозначенный недостаток данных; КОНЕЦ-ОГРАНИЧЕНИЯ-${index + 1}.`).join("\n"),
  questions: Array.from({ length: 6 }, (_, index) => `Вопрос ${index + 1}: попросить кандидата подробно подтвердить результат и измеримый эффект; КОНЕЦ-ВОПРОСА-${index + 1}.`).join("\n"),
};

const sectionTitles: Record<string, string> = {
  identity: "Кандидат",
  scale: "Шкала оценки",
  directions: "ABC-профиль",
  evidence: "Основания",
  conflicts: "Противоречия",
  strengths: "Сильные стороны",
  limitations: "Ограничения",
  questions: "Вопросы HR",
};

const model: ReportModel = {
  type: "abc-test",
  candidateId: "synthetic-candidate-abc",
  candidateDisplayName: "Синтетический Кандидат",
  vacancyId: "synthetic-vacancy-abc",
  vacancyTitle: "Синтетическая вакансия",
  profileVersion: "PROFILE-VERSION-0042",
  analysisVersion: 7,
  generatedAtUtc: "2026-08-26T08:00:00Z",
  recommendation: "Рекомендовать с оговорками",
  sections: Object.keys(sectionTitles).map((id) => ({ id, title: sectionTitles[id], body: sectionBodies[id] })),
  evidence: [],
};

test("E2E-ABC-001 / REP-006 / TST-061,062,064: rendered ABC PDF preserves every complete section, direction and evidence locator", async () => {
  const bytes = await renderCandidatePdf(model);
  await validateRenderedReportPdf(bytes, model);
  const pages = await new PdfJsExtractionAdapter().extract(bytes);
  const text = normalize(pages.map((page) => page.text).join("\n"));

  const requiredText = [
    ...Object.values(sectionTitles),
    ...Object.values(sectionBodies).flatMap((body) => body.split("\n")),
  ].map(normalize);
  const missing = requiredText.filter((expected) => !text.includes(expected));

  assert.deepEqual(missing, [], `ABC PDF lost or shortened ${missing.length} required text item(s):\n${missing.join("\n")}`);
  assert.doesNotMatch(text, /…|\.\.\./, "ABC PDF must not replace complete sentences, results, reasons or evidence locators with ellipsis");
  assert.doesNotMatch(text, /https?:\/\//i, "evidence locators must be plain text, not web links");
  assert.doesNotMatch(Buffer.from(bytes).toString("latin1"), /\/Subtype\s*\/Link\b/, "ABC PDF must not contain clickable link annotations");
});
