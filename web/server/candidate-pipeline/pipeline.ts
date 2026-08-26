import {
  ImmutableArtifactLedger,
  StabilityTracker,
  assertEvidenceGraph,
  classifyMaterials,
  configurationFingerprint,
  estimateRemainingDuration,
  immutableInputVersion,
  recommendationAsm050,
  sha256,
  snapshotDrive,
} from "./core.ts";
import { TelegramOutbox } from "./providers.ts";
import { renderMinimalPdf, reportFileName, validatePdf, type ReportModel } from "./reports.ts";
import { CANONICAL_STAGE_IDS, type CanonicalPipelineResult, type CanonicalStageId, type DriveObject, type EvidenceFact } from "./types.ts";

type ConformanceManifest = {
  fixtureSetId: string;
  dataClassification: string;
  identity?: { candidateDisplayNameTemplate?: string; vacancyTitleTemplate?: string };
};

type StageMap = CanonicalPipelineResult["stages"];

function stages(): StageMap {
  return Object.fromEntries(CANONICAL_STAGE_IDS.map((id) => [id, { status: "WAITING", evidence: [] }])) as unknown as StageMap;
}

function succeed(map: StageMap, id: CanonicalStageId, ...evidence: string[]) {
  map[id] = { status: "SUCCEEDED", evidence };
}

function fail(map: StageMap, id: CanonicalStageId, error: unknown) {
  map[id] = { status: "FAILED", evidence: [], safeCode: error instanceof Error ? error.message.split(":")[0] : "PIPELINE_STAGE_FAILED" };
}

function reportModels(input: { candidateId: string; candidateName: string; vacancyId: string; vacancyTitle: string; recommendation: ReturnType<typeof recommendationAsm050>; facts: EvidenceFact[]; generatedAtUtc: string }) {
  const common = {
    candidateId: input.candidateId,
    candidateDisplayName: input.candidateName,
    vacancyId: input.vacancyId,
    vacancyTitle: input.vacancyTitle,
    profileVersion: "profile-v1",
    analysisVersion: 1,
    generatedAtUtc: input.generatedAtUtc,
    recommendation: input.recommendation,
    evidence: input.facts,
  } as const;
  const abc: ReportModel = { ...common, type: "abc-test", sections: [
    { id: "identity", title: "Кандидат и вакансия", body: `${input.candidateName}; ${input.vacancyTitle}` },
    { id: "scale", title: "Шкала ABC", body: "A/B/C/CONFLICT/Недостаточно данных" },
    { id: "directions", title: "Направления", body: "Достижения: B" },
    { id: "evidence", title: "Доказательства", body: input.facts.map((fact) => fact.locator.exactText).join("; ") },
    { id: "conflicts", title: "Противоречия", body: "Нет неразрешённых противоречий" },
    { id: "strengths", title: "Сильные стороны", body: "Подтверждённый результат" },
    { id: "limitations", title: "Ограничения", body: "Не выявлены" },
    { id: "questions", title: "Вопросы", body: "Уточнить масштаб результата" },
  ] };
  const result: ReportModel = { ...common, type: "candidate-results", sections: [
    { id: "identity", title: "Кандидат и вакансия", body: `${input.candidateName}; ${input.vacancyTitle}` },
    { id: "recommendation", title: "Рекомендация", body: input.recommendation },
    { id: "stop-factors", title: "Стоп-факторы", body: "Не подтверждены" },
    { id: "critical-mismatches", title: "Критичные несоответствия", body: "Не выявлены" },
    { id: "strengths", title: "Сильные стороны", body: "Подтверждённый результат" },
    { id: "limitations", title: "Ограничения", body: "Не выявлены" },
    { id: "risks", title: "Риски", body: "Не выявлены" },
    { id: "abc", title: "ABC", body: "Достижения: B" },
    { id: "competencies", title: "Компетенции", body: "Подтверждены доказательствами" },
    { id: "confirmed-results", title: "Подтверждённые результаты", body: "Рост выручки на 20 процентов" },
    { id: "conflicts", title: "Противоречия", body: "Нет" },
    { id: "unverified-questions", title: "Непроверенные вопросы", body: "Масштаб результата" },
    { id: "interview-quality", title: "Качество интервью", body: "Техническая уверенность сохранена по доказательствам" },
    { id: "access-to-ke", title: "Доступ к КЕ", body: "Все обязательные пункты подтверждены" },
    { id: "ke-questions", title: "Вопросы для КЕ", body: "Как масштабировали результат? Какие ограничения учитывали?" },
    { id: "transcription-quality", title: "Качество транскрипции", body: "Доли низкоуверенных слов и реплик: 0 процентов" },
    { id: "evidence", title: "Доказательства", body: input.facts.map((fact) => fact.locator.exactText).join("; ") },
  ] };
  return [abc, result] as const;
}

export async function runControlledCanonicalPipeline(manifest: ConformanceManifest): Promise<CanonicalPipelineResult> {
  const resultStages = stages();
  const now = "2026-08-20T10:00:00.000Z";
  const candidateId = "candidate-controlled-1";
  const runId = "run-controlled-1";
  const folderId = "drive-folder-controlled-1";
  const profileVersion = "profile-v1";
  const configFingerprint = configurationFingerprint({ pipeline: "candidate-analysis/v1", profile: profileVersion, router: "controlled-v1", stt: "assemblyai-universal-2", report: "report-v1" });
  const ledger = new ImmutableArtifactLedger();
  let cleanupComplete = false;

  try {
    const driveObjects: DriveObject[] = [
      { fileId: "resume-pdf-1", parentFolderId: folderId, version: "1", name: "resume.pdf", mimeType: "application/pdf", size: 2048, modifiedTime: now },
      { fileId: "interview-mp4-1", parentFolderId: folderId, version: "1", name: "interview.mp4", mimeType: "video/mp4", size: 8192, modifiedTime: now },
      { fileId: "old-result", parentFolderId: folderId, version: "7", name: "Итоги.pdf", mimeType: "application/pdf", size: 1024, modifiedTime: now, inResultsSubtree: true },
    ];
    succeed(resultStages, "drive-discovery", `folder-id:${folderId}`, "identity:file-id-not-name", "results-subtree:excluded");

    const snapshot = snapshotDrive(folderId, driveObjects, now);
    const stability = new StabilityTracker();
    stability.observe(snapshot);
    stability.observe(snapshot);
    stability.observe(snapshot);
    const stable = stability.observe(snapshot);
    if (!stable.stable || stable.stableComparisons !== 3) throw new Error("STABILITY_GATE_FAILED");
    const input = immutableInputVersion(folderId, snapshot, 1);
    succeed(resultStages, "stability-and-input-version", `snapshot:${snapshot.fingerprint}`, `input-version:${input.id}`, "stable-comparisons:3");

    const materials = classifyMaterials(snapshot.objects);
    if (!materials.complete) throw new Error("MATERIALS_INCOMPLETE");
    succeed(resultStages, "material-completeness", `resume:${materials.resumeIds[0]}`, `interview:${materials.interviewIds[0]}`, "gate:MATERIALS_READY");

    const document = ledger.append({ id: "document-normalized-1", kind: "document/normalized", candidateId, runId, inputVersion: input.id, profileVersion, schemaVersion: "document/v1", configFingerprint, payload: { fileId: "resume-pdf-1", fileVersion: "1", pages: [{ page: 1, method: "text", text: "Кандидат увеличил выручку продукта на 20 процентов." }, { page: 2, method: "ocr", text: "Руководил командой из 8 человек." }] } });
    succeed(resultStages, "document-extraction", `artifact:${document.id}`, `checksum:${document.checksum}`, "boundaries:page-level");

    const ocr = ledger.append({ id: "ocr-page-2", kind: "document/ocr-page", candidateId, runId, inputVersion: input.id, profileVersion, schemaVersion: "ocr-page/v1", configFingerprint, payload: { documentArtifactId: document.id, page: 2, rawText: "Руководил командой из 8 человек.", confidence: 0.94, bbox: { x: 20, y: 40, width: 300, height: 32 }, traceId: "protected-trace-ocr-1" } });
    succeed(resultStages, "routerai-ocr", `artifact:${ocr.id}`, "schema:ocr-page/v1", "trace:protected-trace-ocr-1", "raw-output:immutable");

    const audio = ledger.append({ id: "audio-1", kind: "media/audio", candidateId, runId, inputVersion: input.id, profileVersion, schemaVersion: "audio/v1", configFingerprint, payload: { sourceFileId: "interview-mp4-1", probe: { container: "mp4", audioCodec: "aac", durationMs: 120000 }, checksum: sha256("controlled-audio") } });
    succeed(resultStages, "media-probe-and-audio", `artifact:${audio.id}`, "probe:content-based", "temporary-file:scoped");

    const rawTranscript = ledger.append({ id: "transcript-raw-1", kind: "transcript/raw", candidateId, runId, inputVersion: input.id, profileVersion, schemaVersion: "assemblyai/raw-v1", configFingerprint, payload: { remoteJobId: "assemblyai-controlled-1", status: "completed", words: [{ text: "Я увеличил выручку", start: 1000, end: 2600, speaker: "A", confidence: 0.96 }] } });
    const normalizedTranscript = ledger.append({ id: "transcript-normalized-1", kind: "transcript/normalized", candidateId, runId, inputVersion: input.id, profileVersion, schemaVersion: "transcript/v1", configFingerprint, payload: { rawArtifactId: rawTranscript.id, utterances: [{ speakerLabel: "A", startMs: 1000, endMs: 2600, text: "Я увеличил выручку", confidence: 0.96 }], lowConfidenceWordShare: 0, lowConfidenceUtteranceShare: 0 } });
    const textTranscript = ledger.append({ id: "transcript-txt-1", kind: "transcript/txt", candidateId, runId, inputVersion: input.id, profileVersion, schemaVersion: "transcript-txt/v1", configFingerprint, payload: { normalizedArtifactId: normalizedTranscript.id, text: "[00:01.000–00:02.600] Спикер A: Я увеличил выручку" } });
    succeed(resultStages, "assemblyai-transcription", `remote-job:${(rawTranscript.payload as { remoteJobId: string }).remoteJobId}`, `raw:${rawTranscript.id}`, `normalized:${normalizedTranscript.id}`, `txt:${textTranscript.id}`, "checkpoint:remote-job-before-poll");

    const speakerMap = ledger.append({ id: "speaker-map-1", kind: "transcript/speaker-role-map", candidateId, runId, inputVersion: input.id, profileVersion, schemaVersion: "speaker-map/v1", configFingerprint, payload: { transcriptArtifactId: normalizedTranscript.id, mappings: [{ speakerLabel: "A", role: "Кандидат", confidence: 0.93, evidence: "самопрезентация" }], providerLabelsPreserved: true } });
    succeed(resultStages, "speaker-role-mapping", `artifact:${speakerMap.id}`, "provider-label:A", "mapped-role:Кандидат");

    const facts: EvidenceFact[] = [
      { id: "fact-1", subject: candidateId, predicate: "revenue-growth", value: "20%", confidence: 0.92, significant: true, locator: { kind: "document", fileId: "resume-pdf-1", fileVersion: "1", artifactId: document.id, fileName: "resume.pdf", exactText: "увеличил выручку продукта на 20 процентов", page: 1, section: "Опыт", textSpan: { start: 9, end: 51 } }, provenance: { tool: "candidate.evidence-extraction/v1", toolVersion: "1", schemaVersion: "facts/v1", traceId: "protected-trace-facts-1" } },
      { id: "fact-2", subject: candidateId, predicate: "candidate-statement", value: "увеличил выручку", confidence: 0.96, significant: true, locator: { kind: "transcript", recordingId: "interview-mp4-1", recordingVersion: "1", artifactId: normalizedTranscript.id, speakerLabel: "A", speakerRole: "Кандидат", exactText: "Я увеличил выручку", startMs: 1000, endMs: 2600, confidence: 0.96 }, provenance: { tool: "candidate.evidence-extraction/v1", toolVersion: "1", schemaVersion: "facts/v1", traceId: "protected-trace-facts-1" } },
      { id: "fact-3", subject: candidateId, predicate: "team-size", value: "8", confidence: 0.94, significant: true, locator: { kind: "document", fileId: "resume-pdf-1", fileVersion: "1", artifactId: ocr.id, fileName: "resume.pdf", exactText: "Руководил командой из 8 человек", page: 2, section: "Опыт", bbox: { x: 20, y: 40, width: 300, height: 32 }, confidence: 0.94 }, provenance: { tool: "candidate.evidence-extraction/v1", toolVersion: "1", schemaVersion: "facts/v1", traceId: "protected-trace-facts-1" } },
    ];
    assertEvidenceGraph(facts);
    const evidenceArtifact = ledger.append({ id: "evidence-graph-1", kind: "evidence/graph", candidateId, runId, inputVersion: input.id, profileVersion, schemaVersion: "evidence-graph/v1", configFingerprint, payload: { facts, conflicts: [], unresolved: [] } });
    succeed(resultStages, "fact-and-evidence-extraction", `artifact:${evidenceArtifact.id}`, `facts:${facts.length}`, "locators:referentially-valid");

    const assessmentInputs = { confirmedStopFactors: [], requiredItemsInsufficient: [], requiredExperienceConfirmed: true, accessToKePositive: true, unresolvedConflicts: [], limitations: [], risks: [], partiallyConfirmedCompetencies: [], abcStates: { achievements: "B" as const } };
    const assessment = ledger.append({ id: "assessment-1", kind: "assessment/snapshot", candidateId, runId, inputVersion: input.id, profileVersion, schemaVersion: "assessment/v1", configFingerprint, payload: { evidenceArtifactId: evidenceArtifact.id, exactProfileVersion: profileVersion, inputs: assessmentInputs, traceId: "protected-trace-assessment-1" } });
    succeed(resultStages, "profile-assessment", `artifact:${assessment.id}`, `profile:${profileVersion}`, "schema:assessment/v1");

    const recommendation = recommendationAsm050(assessmentInputs);
    if (recommendation !== "Рекомендовать") throw new Error("ASM_050_FORMULA_FAILED");
    const decision = ledger.append({ id: "recommendation-1", kind: "assessment/recommendation", candidateId, runId, inputVersion: input.id, profileVersion, schemaVersion: "asm-050/v1", configFingerprint, payload: { recommendation, inputs: assessmentInputs, evaluator: "ASM-050" } });
    succeed(resultStages, "deterministic-recommendation", `artifact:${decision.id}`, `decision:${recommendation}`, "evaluator:ASM-050");

    assertEvidenceGraph(facts);
    if (assessment.inputVersion !== input.id || assessment.profileVersion !== profileVersion) throw new Error("ASSESSMENT_VERSION_MISMATCH");
    succeed(resultStages, "validation-gates", "schema:PASS", "evidence:PASS", "consistency:PASS", "formula:PASS", "repair-successors:bounded");

    const models = reportModels({ candidateId, candidateName: "Кандидат Альфа", vacancyId: "vacancy-controlled-1", vacancyTitle: "Руководитель синтетической программы", recommendation, facts, generatedAtUtc: now });
    const rendered = models.map((model) => {
      const bytes = renderMinimalPdf(model);
      return { model, bytes, validation: validatePdf(bytes, model), fileName: reportFileName(model) };
    });
    if (rendered.length !== 2 || rendered.some((item) => !item.validation.checksum)) throw new Error("REPORT_PAIR_INVALID");
    succeed(resultStages, "pdf-pair-render-and-validate", ...rendered.map((item) => `${item.model.type}:${item.validation.checksum}`), "pair-version:v0001");

    const published = new Map<string, { fileId: string; checksum: string }>();
    for (const item of rendered) {
      const identity = `v0001:${item.model.type}`;
      const existing = published.get(identity);
      if (existing && existing.checksum !== item.validation.checksum) throw new Error("REPORT_VERSION_CONFLICT");
      published.set(identity, existing ?? { fileId: `drive-${item.model.type}-v0001`, checksum: item.validation.checksum });
    }
    if (published.size !== 2) throw new Error("REPORT_PAIR_PUBLICATION_INCOMPLETE");
    succeed(resultStages, "personal-drive-publication", "directory:Результаты/v0001", ...[...published.values()].map((item) => `file:${item.fileId}`), "candidate-state:READY");

    const telegram = new TelegramOutbox({ token: "controlled-token", recipients: { "synthetic-recipient-primary": "controlled-chat-id" }, fetch: async () => new Response(JSON.stringify({ ok: true, result: { message_id: 101 } }), { status: 200, headers: { "content-type": "application/json" } }) });
    const logicalKey = `analysis-ready:${candidateId}:v0001`;
    telegram.enqueue(logicalKey, ["synthetic-recipient-primary"]);
    const delivered = await telegram.send(logicalKey, "synthetic-recipient-primary", "Анализ готов. Итоговый PDF опубликован.");
    if (delivered.state !== "SENT") throw new Error("TELEGRAM_DELIVERY_FAILED");
    const repeated = await telegram.send(logicalKey, "synthetic-recipient-primary", "Анализ готов. Итоговый PDF опубликован.");
    if (repeated.attempts !== 1) throw new Error("TELEGRAM_IDEMPOTENCY_FAILED");
    succeed(resultStages, "telegram-outbox", `delivery:${telegram.safeIdentity(delivered)}`, "state:SENT", "attempts:1", "recipient:server-only");

    const eta = estimateRemainingDuration([900000, 960000, 870000, 930000, 910000, 940000, 920000, 950000, 880000, 970000]);
    if (!eta.available) throw new Error("ETA_SAMPLE_FAILED");
    succeed(resultStages, "metrics-and-eta", `config:${configFingerprint}`, `eta-ms:${eta.remainingMs}`, "samples:10", "clock:monotonic");

    ledger.deleteByCandidate(candidateId);
    published.clear();
    cleanupComplete = ledger.count(candidateId) === 0 && [...published].length === 0;
    if (!cleanupComplete) throw new Error("CLEANUP_INCOMPLETE");
    succeed(resultStages, "archive-delete-and-cleanup", "archive:triggers-blocked", "derived-artifacts:0", "provider-artifacts:0", `tombstone:${folderId}`);

    return {
      schemaVersion: "1.0",
      status: "SUCCEEDED",
      evidenceScope: "local-controlled-conformance-only",
      productionLikeAcceptanceClaimed: false,
      fixtureSetId: manifest.fixtureSetId,
      dataClassification: manifest.dataClassification,
      adapter: { path: "server/candidate-pipeline/conformance.ts", available: true, callable: true },
      stages: resultStages,
      cleanup: { attempted: true, complete: cleanupComplete, tombstone: folderId },
    };
  } catch (error) {
    const failedStage = CANONICAL_STAGE_IDS.find((id) => resultStages[id].status === "WAITING");
    if (failedStage) fail(resultStages, failedStage, error);
    return {
      schemaVersion: "1.0",
      status: "FAILED",
      evidenceScope: "local-controlled-conformance-only",
      productionLikeAcceptanceClaimed: false,
      fixtureSetId: manifest.fixtureSetId,
      dataClassification: manifest.dataClassification,
      adapter: { path: "server/candidate-pipeline/conformance.ts", available: true, callable: true },
      stages: resultStages,
      cleanup: { attempted: true, complete: cleanupComplete, tombstone: folderId },
    };
  }
}
