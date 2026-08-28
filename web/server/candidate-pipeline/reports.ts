import { sha256 } from "./core.ts";
import type { EvidenceFact, Recommendation } from "./types.ts";
import type { PDFFont, PDFImage, PDFPage, RGB } from "pdf-lib";
import type { CandidateMatrixRow } from "./matrix-driven.ts";

export type ReportModel = {
  type: "candidate-report";
  candidateId: string;
  candidateDisplayName: string;
  vacancyId: string;
  vacancyTitle: string;
  profileVersion: string;
  analysisVersion: number;
  generatedAtUtc: string;
  recommendation: Recommendation;
  workflowVersion?: string;
  matrixProvenance?: { matrixId: string; checksum: string; skillVersions?: Record<string, string>; policyVersion?: string };
  matrixRows?: readonly CandidateMatrixRow[];
  sections: readonly { id: string; title: string; body: string }[];
  evidence: readonly EvidenceFact[];
  decisionSnapshot?: unknown;
  evidenceCatalog?: readonly { evidenceId: string; quote: string; source?: string; sourceLabel?: string }[];
  sourceMaterials?: readonly ReportSourceMaterial[];
};

export type ReportSourceMaterial = {
  fileName: string;
  roleLabel: string;
  href: string;
  fileId?: string;
};

type ReportMaterialManifest = { entries?: readonly {
  role?: string;
  name?: string;
  fileId?: string;
  mimeType?: string;
  webViewLink?: string;
  supported?: boolean;
  inResultsSubtree?: boolean;
}[] };

function sourceMaterialRoleLabel(role: string, name: string) {
  if (role === "resume") return "Резюме";
  if (role === "interview") return "Интервью";
  if (/транскриб|стенограм|transcri/iu.test(name)) return "Транскрибация";
  if (/рекомендац/iu.test(name)) return "Рекомендации";
  return "Дополнительный документ";
}

function sourceMaterialHref(value: { href?: string; fileId?: string }) {
  if (!value.href) return undefined;
  try {
    const url = new URL(value.href);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    const drive = url.hostname === "drive.google.com" && /^\/file\/d\/[^/]+\/view\/?$/u.test(url.pathname);
    const document = url.hostname === "docs.google.com" && /^\/document\/d\/[^/]+\/edit\/?$/u.test(url.pathname);
    if (!drive && !document) return undefined;
    const targetId = decodeURIComponent(url.pathname.split("/")[3] ?? "");
    if (value.fileId && targetId !== value.fileId) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function projectReportSourceMaterials(manifest: ReportMaterialManifest): ReportSourceMaterial[] {
  return (manifest.entries ?? []).flatMap((entry) => {
    const role = String(entry.role ?? "");
    const fileName = String(entry.name ?? "").trim();
    const fileId = String(entry.fileId ?? "").trim();
    if (!fileName || !fileId || entry.supported === false || entry.inResultsSubtree === true || role === "result" || role === "unsupported") return [];
    const derived = entry.mimeType === "application/vnd.google-apps.document"
      ? `https://docs.google.com/document/d/${encodeURIComponent(fileId)}/edit`
      : `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
    const href = sourceMaterialHref({ href: entry.webViewLink === undefined ? derived : entry.webViewLink, fileId });
    if (!href) return [];
    return [{ fileName, roleLabel: sourceMaterialRoleLabel(role, fileName), href }];
  });
}

export function projectCandidateReportSourceLines(materials: readonly ReportSourceMaterial[]): readonly string[] {
  return materials.flatMap((material) => {
    const fileName = material.fileName.trim();
    return fileName ? [`• ${fileName}`] : [];
  });
}

export type InterviewSummary = {
  interviewDate: string;
  fullName: string;
  age: string;
  compensation: string;
  recentEmployment: readonly {
    employer: string;
    role: string;
    period: string;
    summary: string;
    achievements: string;
  }[];
  hardSkills: readonly string[];
  softSkills: readonly string[];
  positives: readonly string[];
  negatives: readonly string[];
  additional: readonly string[];
};

const REQUIRED: Record<ReportModel["type"], readonly string[]> = {
  "candidate-report": ["identity", "sources", "organizational-conditions", "review", "key-evidence", "abc-directions", "technical-check", "motivation-fit", "risks", "decision", "final-summary"],
};

const SECTION_TITLES: Record<ReportModel["type"], Readonly<Record<string, string>>> = {
  "candidate-report": { identity: "Кандидат и вакансия", sources: "Исходные материалы", "organizational-conditions": "Организационные моменты",
    review: "Ревью", "key-evidence": "Ключевые доказательства", "abc-directions": "ABC по направлениям",
    "technical-check": "Технический чек", "motivation-fit": "Мотивация и соответствие роли", risks: "Риски",
    decision: "Решение", "final-summary": "Финальное HR-резюме" },
};

export function requiredReportSections(type: ReportModel["type"]) { return [...REQUIRED[type]]; }
export function reportSectionTitle(type: ReportModel["type"], sectionId: string) { return SECTION_TITLES[type][sectionId] ?? sectionId; }

type CandidateReportNarrative = {
  decisionSnapshot: unknown;
  sections: Array<{ sectionId: string; statements: Array<{ text: string; evidenceIds: string[] }> }>;
};

export async function composeCandidateReportFailSoft(input: {
  decisionSnapshot: unknown;
  evidenceCatalog: readonly { evidenceId: string; quote: string; source?: string; sourceLabel?: string }[];
  composer: () => Promise<unknown>;
}): Promise<{ model: CandidateReportNarrative; usedFallback: boolean; warnings: string[] }> {
  const required = requiredReportSections("candidate-report");
  const knownEvidence = new Set(input.evidenceCatalog.map((item) => item.evidenceId));
  const fallback = (warning: string) => {
    const evidenceIds = input.evidenceCatalog[0] ? [input.evidenceCatalog[0].evidenceId] : [];
    return { model: { decisionSnapshot: structuredClone(input.decisionSnapshot), sections: required.map((sectionId) => ({ sectionId,
      statements: [{ text: sectionId === "recommendation" ? `Итоговая рекомендация: ${String((input.decisionSnapshot as { recommendation?: unknown })?.recommendation ?? "Недостаточно данных")}` : `Раздел «${reportSectionTitle("candidate-report", sectionId)}» сформирован из проверенной оценки кандидата.`, evidenceIds }] })) },
      usedFallback: true, warnings: [warning] };
  };
  try {
    const raw = await input.composer();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback("REPORT_COMPOSER_SCHEMA_INVALID");
    const value = raw as CandidateReportNarrative;
    if (JSON.stringify(value.decisionSnapshot) !== JSON.stringify(input.decisionSnapshot) || !Array.isArray(value.sections)) return fallback("REPORT_COMPOSER_DECISION_MUTATION");
    const seen = new Set<string>();
    const sectionInputs = new Map<string, Array<{ text: string; evidenceIds: string[] }>>();
    for (const section of value.sections) {
      if (!required.includes(section.sectionId) || !Array.isArray(section.statements)) continue;
      const bucket = sectionInputs.get(section.sectionId) ?? [];
      bucket.push(...section.statements);
      sectionInputs.set(section.sectionId, bucket);
    }
    const sections = required.map((sectionId) => {
      const statements = (sectionInputs.get(sectionId) ?? []).flatMap((statement) => {
        const text = typeof statement?.text === "string" ? statement.text.replace(/\s+/g, " ").trim() : "";
        const key = text.toLocaleLowerCase("ru-RU");
        if (!text || seen.has(key) || !Array.isArray(statement.evidenceIds) || statement.evidenceIds.length === 0
          || statement.evidenceIds.some((id) => !knownEvidence.has(id))) return [];
        seen.add(key);
        return [{ text, evidenceIds: [...new Set(statement.evidenceIds)] }];
      });
      return { sectionId, statements };
    });
    if (sections.some((section) => section.statements.some((statement) => statement.evidenceIds.some((id) => !knownEvidence.has(id))))
      || !sections.some((section) => section.statements.length)) return fallback("REPORT_COMPOSER_EVIDENCE_INVALID");
    const unknownReferences = value.sections.some((section) => section.statements?.some((statement) => statement.evidenceIds?.some((id) => !knownEvidence.has(id))));
    if (unknownReferences) return fallback("REPORT_COMPOSER_EVIDENCE_INVALID");
    return { model: { decisionSnapshot: structuredClone(input.decisionSnapshot), sections }, usedFallback: false, warnings: [] };
  } catch (error) {
    return fallback(error instanceof Error && error.message ? `REPORT_COMPOSER_FALLBACK:${error.message}` : "REPORT_COMPOSER_FALLBACK");
  }
}

export function validateReportModel(model: ReportModel) {
  const present = new Set(model.sections.map((section) => section.id));
  const missing = REQUIRED[model.type].filter((section) => !present.has(section));
  if (missing.length) throw new Error(`REPORT_REQUIRED_SECTIONS_MISSING:${missing.join(",")}`);
  if (!model.candidateId || !model.vacancyId || model.analysisVersion < 1) throw new Error("REPORT_IDENTITY_INVALID");
  if (model.workflowVersion?.startsWith("matrix-v")) {
    if (!model.matrixProvenance?.matrixId || !model.matrixProvenance.checksum || !model.matrixRows?.length) throw new Error("REPORT_MATRIX_PROJECTION_MISSING");
    const renderedIds = new Set(model.matrixRows.map((row) => row.criterionId));
    if (renderedIds.size !== model.matrixRows.length) throw new Error("REPORT_MATRIX_ROW_DUPLICATE");
    if (model.type !== "candidate-report") {
      if (!present.has("matrix")) throw new Error("REPORT_MATRIX_PROJECTION_MISSING");
      if (model.matrixRows.some((row) => !present.has(`matrix:${row.criterionId}`))) throw new Error("REPORT_MATRIX_ROW_SECTION_MISSING");
    }
  }
  return true;
}

function escapePdf(value: string) {
  return value.normalize("NFKD").replace(/[^\x20-\x7E]/g, "?").replace(/[()\\]/g, (character) => `\\${character}`);
}

export function renderMinimalPdf(model: ReportModel) {
  validateReportModel(model);
  const lines = [
    `${model.type} | candidate=${model.candidateId} | vacancy=${model.vacancyId}`,
    `profile=${model.profileVersion} | analysis=v${String(model.analysisVersion).padStart(4, "0")}`,
    `recommendation=${model.recommendation}`,
    ...model.sections.map((section) => `${section.id}: ${section.title} - ${section.body}`),
  ];
  const stream = `BT /F1 9 Tf 40 800 Td ${lines.map((line, index) => `${index ? "0 -13 Td " : ""}(${escapePdf(line)}) Tj`).join(" ")} ET`;
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >> endobj",
    `4 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}\nendstream endobj`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) { offsets.push(Buffer.byteLength(body)); body += `${object}\n`; }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body));
}

export async function renderCandidatePdf(model: ReportModel, options: { fontBytes?: Uint8Array } = {}) {
  validateReportModel(model);
  const [{ PDFDocument, PDFString, rgb }, fontkit, { readFile }] = await Promise.all([import("pdf-lib"), import("@pdf-lib/fontkit"), import("node:fs/promises")]);
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit.default);
  const fontBytes = options.fontBytes ?? new Uint8Array(await readFile(new URL("../../node_modules/pdfmake/fonts/Roboto/Roboto-Regular.ttf", import.meta.url)));
  const font = await document.embedFont(fontBytes, { subset: true });
  const boldBytes = new Uint8Array(await readFile(new URL("../../node_modules/pdfmake/fonts/Roboto/Roboto-Medium.ttf", import.meta.url)));
  const bold = await document.embedFont(boldBytes, { subset: true });
  const logoBytes = new Uint8Array(await readFile(new URL("../../public/company-logo.png", import.meta.url)));
  const logo = await document.embedPng(logoBytes);
  const pageSize = { width: 595.28, height: 841.89 };
  let page = document.addPage([pageSize.width, pageSize.height]);
  const ink = rgb(0.10, 0.14, 0.18);
  const muted = rgb(0.38, 0.44, 0.50);
  const blue = rgb(0.05, 0.42, 0.72);
  const paleBlue = rgb(0.94, 0.97, 0.99);
  const line = rgb(0.83, 0.87, 0.90);
  page.drawImage(logo, { x: 40, y: 774, width: 34, height: 34 });
  page.drawText("Правильный выбор", { x: 83, y: 793, size: 12, font: bold, color: ink });
  page.drawText("AI-анализ кандидатов", { x: 83, y: 778, size: 7.5, font, color: muted });
  const reportTitle = "Отчёт по кандидату";
  page.drawText(reportTitle, { x: 40, y: 742, size: 19, font: bold, color: ink });
  page.drawText(`Кандидат: ${sanitizeReportText(model.candidateDisplayName)}`, { x: 40, y: 716, size: 9, font: bold, color: ink });
  page.drawText(`Вакансия: ${sanitizeReportText(model.vacancyTitle)}`, { x: 40, y: 700, size: 9, font, color: ink });
  page.drawText(new Date(model.generatedAtUtc).toLocaleDateString("ru-RU", { timeZone: "UTC" }), { x: 485, y: 716, size: 8, font, color: muted });
  const compactHrReport = true;

  const visibleSections = reportVisibleSections(model);
  const singleColumn = true;
  const columnGap = 12;
  const columnWidth = singleColumn ? 515 : (515 - columnGap) / 2;
  const left = 40;
  const top = compactHrReport ? 680 : 628;
  const bottom = 58;
  let columnY = [top, top];
  const addSourceLink = (targetPage: PDFPage, href: string, x: number, y: number, width: number, height: number) => {
    const safeHref = sourceMaterialHref({ href });
    if (!safeHref) return;
    const annotation = document.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [x, y, x + width, y + height],
      Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(safeHref) },
    });
    targetPage.node.addAnnot(document.context.register(annotation));
  };
  const addContinuationPage = () => {
    page = document.addPage([pageSize.width, pageSize.height]);
    page.drawText(`${reportTitle} · продолжение`, { x: 40, y: 806, size: 11, font: bold, color: ink });
    page.drawText(sanitizeReportText(model.candidateDisplayName), { x: 40, y: 787, size: 8.5, font, color: muted });
    columnY = [766, 766];
  };
  visibleSections.forEach((section, index) => {
    const column = singleColumn ? 0 : index % 2;
    const x = left + column * (columnWidth + columnGap);
    const bodySize = singleColumn ? 10.2 : 9.2;
    const bodyLineHeight = singleColumn ? 13.6 : 12.2;
    const pending = sectionParagraphLines(section.body, columnWidth - 20, font, bodySize);
    const sourceLineLinks = new Map<string, string[]>();
    if (section.id === "sources") for (const material of model.sourceMaterials ?? []) {
      const href = sourceMaterialHref(material);
      if (!href) continue;
      const sourceLine = projectCandidateReportSourceLines([material])[0];
      if (!sourceLine) continue;
      for (const text of sectionParagraphLines(sourceLine, columnWidth - 20, font, bodySize).flat()) {
        sourceLineLinks.set(text, [...(sourceLineLinks.get(text) ?? []), href]);
      }
    }
    let continuation = false;
    do {
      const cardChromeHeight = compactHrReport ? 39 : 41;
      let availableLines = Math.floor((columnY[column] - bottom - cardChromeHeight) / bodyLineHeight);
      if (availableLines < 1) {
        addContinuationPage();
        availableLines = Math.floor((columnY[column] - bottom - cardChromeHeight) / bodyLineHeight);
      }
      const bodyLines: string[] = [];
      while (pending.length && bodyLines.length + pending[0].length <= availableLines) bodyLines.push(...pending.shift()!);
      if (!bodyLines.length && pending.length) {
        bodyLines.push(...pending[0].splice(0, Math.max(1, availableLines)));
        if (!pending[0].length) pending.shift();
      }
      const height = cardChromeHeight + bodyLines.length * bodyLineHeight;
      const y = columnY[column] - height;
      const title = continuation ? `${section.title} · продолжение` : section.title;
      if (compactHrReport) {
        page.drawText(sanitizeReportText(title), { x, y: y + height - 17, size: 12, font: bold, color: blue });
        page.drawLine({ start: { x, y: y + height - 23 }, end: { x: x + columnWidth, y: y + height - 23 }, thickness: 0.55, color: line });
        bodyLines.forEach((bodyLine, bodyIndex) => {
          const lineY = y + height - 38 - bodyIndex * bodyLineHeight;
          const sourceLinks = sourceLineLinks.get(bodyLine);
          const sourceHref = sourceLinks?.shift();
          const isLinkedSource = Boolean(sourceHref);
          page.drawText(bodyLine, { x, y: lineY, size: bodySize, font, color: isLinkedSource ? blue : ink });
          if (isLinkedSource) {
            const width = Math.min(columnWidth, font.widthOfTextAtSize(bodyLine, bodySize));
            page.drawLine({ start: { x, y: lineY - 1.2 }, end: { x: x + width, y: lineY - 1.2 }, thickness: 0.35, color: blue });
            addSourceLink(page, sourceHref!, x, lineY - 2, width, bodyLineHeight);
          }
        });
        columnY[column] = y - 13;
      } else {
        page.drawRectangle({ x, y, width: columnWidth, height, borderColor: line, borderWidth: 0.7, color: rgb(0.995, 0.997, 1) });
        page.drawText(sanitizeReportText(title), { x: x + 10, y: y + height - 20, size: singleColumn ? 12 : 11, font: bold, color: blue });
        bodyLines.forEach((bodyLine, bodyIndex) => page.drawText(bodyLine, { x: x + 10, y: y + height - 37 - bodyIndex * bodyLineHeight, size: bodySize, font, color: ink }));
        columnY[column] = y - 10;
      }
      continuation = true;
      if (pending.length) addContinuationPage();
    } while (pending.length);
  });
  document.getPages().forEach((reportPage, index) => {
    reportPage.drawLine({ start: { x: 40, y: 40 }, end: { x: 555, y: 40 }, thickness: 0.6, color: line });
    reportPage.drawText("Сформировано системой «Правильный выбор»", { x: 40, y: 24, size: 7.5, font, color: muted });
    reportPage.drawText(`${index + 1} / ${document.getPageCount()}`, { x: 520, y: 24, size: 7.5, font, color: muted });
  });
  document.setTitle(reportFileName(model));
  document.setSubject(`${reportTitle}: ${sanitizeReportText(model.candidateDisplayName)}`);
  document.setProducer("AI screener report-tool/v1");
  return new Uint8Array(await document.save({ useObjectStreams: false }));
}

function renderInterviewSummary(
  page: PDFPage,
  model: ReportModel,
  summary: InterviewSummary,
  style: {
    font: PDFFont;
    bold: PDFFont;
    ink: RGB;
    muted: RGB;
    blue: RGB;
    line: RGB;
    logo: PDFImage;
  },
) {
  const { font, bold, ink, muted, blue, line, logo } = style;
  const left = 40;
  const width = 515;
  const bodySize = 10.4;
  const lineHeight = 12.6;
  let y = 802;
  page.drawImage(logo, { x: left, y: y - 25, width: 26, height: 26 });
  page.drawText("Правильный выбор", { x: left + 34, y: y - 10, size: 10.5, font: bold, color: ink });
  page.drawText("AI-анализ кандидатов", { x: left + 34, y: y - 22, size: 6.7, font, color: muted });
  y -= 48;
  page.drawText("Итоги интервью", { x: left, y, size: 16, font: bold, color: ink });
  y -= 22;

  const drawLabelValue = (label: string, value: string) => {
    const safeLabel = sanitizeReportText(label);
    const safeValue = sanitizeReportText(value) || "Не указано";
    page.drawText(safeLabel, { x: left, y, size: bodySize, font: bold, color: ink });
    const labelWidth = bold.widthOfTextAtSize(safeLabel, bodySize);
    const valueLines = wrap(safeValue, bodySize, font, width - labelWidth - 6);
    valueLines.slice(0, 2).forEach((text, index) => page.drawText(text, { x: left + labelWidth + 5, y: y - index * lineHeight, size: bodySize, font, color: ink }));
    y -= Math.max(1, Math.min(2, valueLines.length)) * lineHeight;
  };
  drawLabelValue("Дата:", summary.interviewDate);
  drawLabelValue("ФИО кандидата:", summary.fullName);
  drawLabelValue("Вакантная должность:", model.vacancyTitle);
  drawLabelValue("Возраст кандидата:", summary.age);
  drawLabelValue("Зарплата на данный момент/ожидания:", summary.compensation);
  y -= 4;

  const drawHeading = (title: string) => {
    page.drawText(title, { x: left, y, size: 11.5, font: bold, color: blue });
    y -= 15;
  };
  const drawParagraph = (value: string, options: { prefix?: string; maxLines?: number } = {}) => {
    const prefix = options.prefix ?? "";
    const lines = wrap(`${prefix}${sanitizeReportText(value) || "Не указано"}`, bodySize, font, width).slice(0, options.maxLines ?? 4);
    for (const text of lines) {
      if (y < 48) break;
      page.drawText(text, { x: left, y, size: bodySize, font, color: ink });
      y -= lineHeight;
    }
  };
  const drawNumbered = (items: readonly string[], maximum: number) => {
    (items.length ? items : ["Недостаточно подтверждённых данных."]).slice(0, maximum).forEach((item, index) => {
      drawParagraph(item, { prefix: `${index + 1}. `, maxLines: 2 });
    });
  };

  drawHeading("Последние места работы:");
  (summary.recentEmployment.length ? summary.recentEmployment : [{ employer: "Не указано", role: "Не указано", period: "", summary: "", achievements: "" }]).slice(0, 2).forEach((employment) => {
    drawParagraph(employment.employer, { maxLines: 1 });
    drawParagraph(employment.role, { maxLines: 1 });
    if (employment.period) drawParagraph(employment.period, { maxLines: 1 });
    if (employment.summary) drawParagraph(employment.summary, { maxLines: 3 });
    drawParagraph(employment.achievements || "Не указаны", { prefix: "• Достижения: ", maxLines: 2 });
  });
  y -= 3;
  drawHeading("Hard skills:");
  drawNumbered(summary.hardSkills, 9);
  y -= 3;
  drawHeading("Soft skills:");
  drawNumbered(summary.softSkills, 7);
  y -= 3;
  drawHeading("Плюсы кандидата:");
  drawParagraph(summary.positives.join(" "), { maxLines: 5 });
  y -= 3;
  drawHeading("Минусы кандидата:");
  drawParagraph(summary.negatives.join(" "), { maxLines: 5 });
  y -= 3;
  drawHeading("ДОПОЛНИТЕЛЬНО:");
  drawParagraph(summary.additional.join(" "), { maxLines: 5 });

  page.drawLine({ start: { x: left, y: 35 }, end: { x: left + width, y: 35 }, thickness: 0.6, color: line });
  page.drawText("Сформировано системой «Правильный выбор»", { x: left, y: 21, size: 7.5, font, color: muted });
}

const VISIBLE_SECTIONS: Record<ReportModel["type"], readonly string[]> = {
  "candidate-report": ["identity", "sources", "organizational-conditions", "review", "key-evidence", "abc-directions", "technical-check", "motivation-fit", "risks", "decision", "final-summary"],
};

function reportVisibleSections(model: ReportModel) {
  const allowed = new Set(VISIBLE_SECTIONS[model.type]);
  return model.sections
    .filter((section) => allowed.has(section.id))
    .map((section) => ({ ...section, title: hrSafeReportText(section.title), body: hrSafeReportText(
      section.id === "sources" && model.sourceMaterials?.length
        ? projectCandidateReportSourceLines(model.sourceMaterials).join("\n")
        : section.body,
    ) }));
}

export function hrSafeReportText(value: string) {
  return normalizeReportBodyText(value)
    .replace(/\s*Проверяющий отметил\s*:?.*$/giu, "")
    .replace(/\s*Дополнительное наблюдение\s*:\s*(?:(?:candidateId|documentId|artifactId|fileId|page|textSpan|utteranceId|sourceRef)?\s*=\s*[^;,.\s]+\s*;?\s*)+$/giu, "")
    .replace(/\s*Дополнительное наблюдение\s*:\s*$/giu, "")
    .replace(/candidate:\/\/\/[^\s;,) ]*/giu, "")
    .replace(/\b(?:claim|criterion)-[a-z0-9._-]+\b/giu, "")
    .replace(/\bartifactId\b/giu, "")
    .replace(/\b[a-z][a-z0-9-]+\/v\d+\b/giu, "")
    .replace(/\b(?:candidate-)?policy-v\d+\b/giu, "")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "")
    .replace(/\b(?:candidate|vacancy|profile|run|artifact|file)[:=][^\s;,\]]+/gi, "")
    .replace(/(?:^|[;\s])=[a-z0-9._-]+(?:[;\s]|$)/giu, " ")
    .replace(/\b(?:candidateId|documentId|textSpan|utteranceId|sourceRef|page)=[^\s;,\]]+/giu, "")
    .replace(/\[\s*\]/g, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/[^\S\r\n]{2,}/g, " ")
    .replace(/ *\r?\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s*(?:Дополнительное наблюдение|Дополнительная сильная сторона из материалов)\s*:\s*[;,.]*\s*$/giu, "")
    .trim();
}

function sanitizeReportText(value: string) { return hrSafeReportText(value); }

function normalizeReportBodyText(value: string) {
  return value
    .replace(/\[\s*\]/g, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/[^\S\r\n]{2,}/g, " ")
    .replace(/ *\r?\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sectionParagraphLines(body: string, maxWidth: number, font: { widthOfTextAtSize(value: string, size: number): number }, bodySize = 8.1) {
  const cleaned = normalizeReportBodyText(body)
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[•*-]\s*/, "• ").trim())
    .filter(Boolean);
  return cleaned.map((paragraph) => wrap(paragraph, bodySize, font, maxWidth));
}

function wrap(text: string, size: number, font: { widthOfTextAtSize(value: string, size: number): number }, maxWidth: number) {
  const result: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) { result.push(line); line = word; } else line = candidate;
    }
    result.push(line || " ");
  }
  return result;
}

export async function validateRenderedReportPdf(bytes: Uint8Array, model: ReportModel) {
  const structural = validatePdf(bytes, model);
  const { PdfJsExtractionAdapter } = await import("./documents.ts");
  const pages = await new PdfJsExtractionAdapter().extract(bytes);
  const text = pages.map((page) => page.text).join(" ").replace(/\s+/g, " ");
  if (!pages.length || pages.length > 50 || bytes.byteLength > 5_000_000) throw new Error("PDF_READABILITY_BUDGET_EXCEEDED");
  const requiredContent = [model.candidateDisplayName, model.vacancyTitle, model.recommendation,
    ...reportVisibleSections(model).flatMap((section) => [section.title])];
  const normalizedRequiredContent = requiredContent.map(sanitizeReportText);
  const missing = normalizedRequiredContent.filter((value) => value && !renderedTextContains(text, value));
  return {
    ...structural,
    pageCount: pages.length,
    textChecksum: sha256(text),
    contentOraclePassed: missing.length === 0,
    contentOracleWarningCount: missing.length,
    contentOracleWarningFingerprints: missing.map((value) => sha256(value).slice(0, 16)),
    warnings: missing.map((value) => `PDF_CONTENT_ORACLE_FAILED:${sha256(value).slice(0, 16)}`),
  };
}

function renderedTextContains(renderedText: string, requiredValue: string) {
  const normalized = requiredValue.replace(/\s+/g, " ").trim();
  if (!normalized || renderedText.includes(normalized)) return true;

  const renderedTokens = renderedText.split(/\s+/).filter(Boolean);
  const requiredTokens = normalized.split(/\s+/).filter(Boolean);
  for (let start = 0; start < renderedTokens.length; start += 1) {
    if (renderedTokens[start] !== requiredTokens[0]) continue;
    let renderedIndex = start + 1;
    let complete = true;
    for (const requiredToken of requiredTokens.slice(1)) {
      const maximumIndex = Math.min(renderedTokens.length, renderedIndex + 32);
      let matchedIndex = -1;
      for (let index = renderedIndex; index < maximumIndex; index += 1) {
        if (renderedTokens[index] === requiredToken) {
          matchedIndex = index;
          break;
        }
      }
      if (matchedIndex < 0) {
        complete = false;
        break;
      }
      renderedIndex = matchedIndex + 1;
    }
    if (complete) return true;
  }
  return false;
}

export function validatePdf(bytes: Uint8Array, model: ReportModel) {
  validateReportModel(model);
  const text = Buffer.from(bytes).toString("latin1");
  if (!text.startsWith("%PDF-") || !text.trimEnd().endsWith("%%EOF") || bytes.byteLength < 100) throw new Error("INVALID_PDF_STRUCTURE");
  return { checksum: sha256(bytes), size: bytes.byteLength };
}

export function reportFileName(model: ReportModel) {
  return `Отчёт по кандидату — ${model.candidateDisplayName} — v${String(model.analysisVersion).padStart(4, "0")}.pdf`;
}
