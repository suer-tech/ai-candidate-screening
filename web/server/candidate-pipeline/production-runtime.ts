import { createHash } from "node:crypto";
import { PostgresAgentRuntimeRepository } from "../agent-runtime/postgres-runtime-repository.ts";
import { withTransaction, type PostgresClient } from "../storage/postgres.ts";
import { PostgresBlobStore } from "../storage/blob-store.ts";
import { createGoogleDriveOAuthRuntime } from "../google-drive-oauth/runtime.ts";
import type { GoogleDriveOAuthEnvironment } from "../google-drive-oauth/types.ts";
import { classifyMaterials, sha256 } from "./core.ts";
import type { CandidatePipelineEnvironment } from "./readiness.ts";
import type { ProductionRuntime } from "./tool-executor.ts";
import type { DriveObject } from "./types.ts";
import { PostgresCandidateArtifactStore } from "./artifact-store.ts";
import { DurableAssemblyAiAdapter } from "./providers.ts";
import { parseReadyTranscript, transcriptRepresentations, type TranscriptUtterance, type TranscriptWord } from "./transcription.ts";
import { processDocument, type ExtractedPage, type ExtractedSection, type ProcessedDocument } from "./documents.ts";
import { RouterAiPageOcrAdapter } from "./router-tools.ts";
import { runLlmCapabilityWithPolicy, type CapabilityBudget } from "./capability-runner.ts";
import { loadRuntimeConfiguration } from "../llm/runtime-loader.ts";
import { OpenAiCompatibleProviderAdapter } from "../llm/openai-compatible-adapter.ts";
import { AdminOnlyProtectedTraceStore } from "../llm/protected-store.ts";
import { PostgresProtectedTracePersistence } from "../llm/postgres-persistence.ts";
import { LlmProviderAttemptError, type ExecuteLlmAttemptDependencies } from "../llm/gateway.ts";
import type { TraceCorrelation } from "../llm/tracing.ts";
import type { JsonValue } from "../llm/value-utils.ts";
import type { AssessmentInputs, EvidenceFact, EvidenceLocator } from "./types.ts";
import { composeCandidateReportFailSoft, projectCandidateReportSourceLines, projectReportSourceMaterials, reportFileName, reportSectionTitle, requiredReportSections, type ReportModel } from "./reports.ts";
import { PostgresNotificationStore, NotificationDispatcher, ServerRecipientRegistry, TelegramBotTransport } from "./notifications.ts";
import { successTelegramTemplate } from "./operations.ts";
import { PostgresVacancyMatrixRepository } from "./matrix-postgres-repository.ts";
import { compileVacancyMatrix, type MatrixCompilationSkills } from "./matrix-compilation.ts";
import { MATRIX_WORKFLOW_VERSION, applyCriticalVerificationDecisions, candidateClaimIsDecisionAdmissible, decisionSafeJson, matrixChecksum, validateCandidateMatrixRows, type CandidateMatrixRow, type CandidateSourceClaim, type CriticalUnmappedRisk, type CriticalVerificationDecision, type MatrixCriterion } from "./matrix-driven.ts";
import { normalizeMatrixCapabilityOutput, type MatrixCapability } from "./matrix-schemas.ts";
import { buildCriterionClaimExtractionBatches } from "./transcript-claim-batching.ts";
import { recoveryArtifactPurpose, recoveryArtifactSchema } from "./recovery-contracts.ts";
import { deduplicateCoverageEvidence, matrixCriterionIds, technicalFallbackRow, validateExactCriterionCoverage, type BatchCoverageEntry } from "./matrix-coverage.ts";
import { countOpenAiCompatibleContextTokens } from "../llm/token-counting.ts";

type ExecutionEnvironment = CandidatePipelineEnvironment & GoogleDriveOAuthEnvironment;

type OrganizationalFact = Pick<EvidenceFact, "predicate" | "value"> & { locator?: unknown };
type OrganizationalClaim = Pick<CandidateSourceClaim, "sourceClass" | "text" | "locator">;

export function projectOrganizationalConditions(facts: readonly OrganizationalFact[], claims: readonly OrganizationalClaim[] = []): readonly string[] {
  const missingValue = /(?:не\s+(?:указан|указана|указано|назван|названа|названо|раскрыт|раскрыта|раскрыто|сообщил|сообщила)|нет\s+(?:данных|сведений|информации)|отсутств(?:ует|уют)|неизвестн)/iu;
  const groundedValue = (patterns: readonly RegExp[]) => {
    const fact = facts.find((candidate) => patterns.some((pattern) => pattern.test(candidate.predicate))
      && Boolean(candidate.locator && typeof candidate.locator === "object" && !Array.isArray(candidate.locator))
      && typeof candidate.value === "string" && candidate.value.trim() && !missingValue.test(candidate.value));
    return fact?.value.replace(/\s+/g, " ").trim().replace(/;+$/u, "") || "не указано";
  };
  const claimValue = (sourceClass: string, fallback?: RegExp) => {
    const exact = claims.filter((claim) => claim.sourceClass === sourceClass);
    const candidates = exact.length ? exact : claims.filter((claim) => Boolean(fallback?.test(claim.text)));
    return candidates.map((claim) => claim.text.replace(/\s+/g, " ").trim().replace(/;+$/u, ""))
      .find((value) => value && !missingValue.test(value)) || "";
  };
  const rawWorkFormat = claimValue("report.organization.work-format", /(?:удал[её]н|гибрид|офисн).*(?:формат|вариант)|(?:формат|вариант).*(?:удал[её]н|гибрид|офисн)/iu);
  const workFormat = /гибрид/iu.test(rawWorkFormat) ? "гибрид" : /удал[её]н/iu.test(rawWorkFormat) ? "удалённо" : /офис/iu.test(rawWorkFormat) ? "офис" : rawWorkFormat;
  const city = claimValue("report.organization.city", /(?:нахожусь|живу|адрес|город|Ростов-на-Дону|Москва|Санкт-Петербург)/iu);
  const formatAndCity = [workFormat, city].filter((value, index, values) => value && values.findIndex((item) => item.toLocaleLowerCase("ru-RU").includes(value.toLocaleLowerCase("ru-RU")) || value.toLocaleLowerCase("ru-RU").includes(item.toLocaleLowerCase("ru-RU"))) === index).join(", ");
  return [
    `Формат: ${formatAndCity || groundedValue([/^conditions\.(?:work_format_city|workFormatCity|work_format_and_city|workFormat|location_and_mobility|location)$/i])};`,
    `Доход: ${claimValue("report.organization.income") || groundedValue([/^conditions\.(?:expected_net_income|expectedNetIncome|compensation)$/i, /^stopFactor\.compensationExpectation$/i])};`,
    `Готов к тестовому дню: ${claimValue("report.organization.trial-day", /тестов(?:ому|ый)\s+д(?:ню|ень)/iu) || groundedValue([/^conditions\.(?:trial_day_readiness|trialDayReadiness)$/i])};`,
    `Готов к выходу: ${claimValue("report.organization.start") || groundedValue([/^conditions\.(?:start_readiness|startReadiness|start_availability)$/i, /^references\.availability$/i])};`,
  ];
}

function text(value: unknown, code: string) {
  if (typeof value !== "string" || !value) throw new Error(code);
  return value;
}

function integer(value: unknown, code: string) {
  if (!Number.isInteger(value)) throw new Error(code);
  return Number(value);
}

export function safeCandidateStageError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message !== "PRODUCTION_TOOL_EXECUTION_FAILED"
    && error.message !== "TOOL_EXECUTOR_REQUEST_FAILED"
    && /^[A-Z][A-Z0-9_.-]*(?::[A-Za-z0-9_.-]+)*$/.test(error.message)) {
    console.info(JSON.stringify({ event: "candidate-stage-error", phase: fallback, safeCode: error.message }));
    return error;
  }
  console.info(JSON.stringify({ event: "candidate-stage-error", phase: fallback, safeCode: fallback }));
  return new Error(fallback);
}

async function queryRows<T>(database: PostgresClient, statement: string, parameters: readonly unknown[] = []): Promise<T[]> {
  return await database.unsafe(statement, [...parameters] as never[]) as unknown as T[];
}

async function queryOne<T>(database: PostgresClient, statement: string, parameters: readonly unknown[] = []): Promise<T | undefined> {
  return (await queryRows<T>(database, statement, parameters))[0];
}

async function execute(database: PostgresClient, statement: string, parameters: readonly unknown[] = []): Promise<number> {
  const result = await database.unsafe(statement, [...parameters] as never[]);
  return result.count;
}

export async function latestDomainArtifactReference(database: PostgresClient, runId: string, provenance: string) {
  return (await queryOne<{ storage_identity: string }>(database, `WITH RECURSIVE run_lineage(id,depth) AS (
      SELECT $1::text,0
      UNION ALL
      SELECT source_run.recovery_source_run_id,lineage.depth+1 FROM agent_runs source_run
      JOIN run_lineage lineage ON source_run.id=lineage.id
      WHERE source_run.recovery_source_run_id IS NOT NULL AND lineage.depth<32
    )
    SELECT ref.storage_identity FROM run_lineage lineage JOIN agent_memory_entries memory ON memory.run_id=lineage.id
    JOIN agent_artifact_refs ref ON ref.memory_entry_id=memory.id
    LEFT JOIN candidate_domain_artifacts domain ON domain.run_id=memory.run_id AND domain.payload_ref=ref.storage_identity
    WHERE memory.provenance=$2
    ORDER BY lineage.depth,domain.created_at_utc DESC NULLS LAST,ref.id DESC LIMIT 1`, [runId, provenance]))?.storage_identity;
}

export async function domainArtifactReferences(database: PostgresClient, runId: string, provenance: string) {
  const rows = await queryRows<{ storage_identity: string; checksum: string }>(database, `WITH RECURSIVE run_lineage(id,depth) AS (
      SELECT $1::text,0
      UNION ALL
      SELECT source_run.recovery_source_run_id,lineage.depth+1 FROM agent_runs source_run
      JOIN run_lineage lineage ON source_run.id=lineage.id
      WHERE source_run.recovery_source_run_id IS NOT NULL AND lineage.depth<32
    ), matching AS (
      SELECT lineage.id,lineage.depth FROM run_lineage lineage
      WHERE EXISTS (SELECT 1 FROM agent_memory_entries candidate_memory WHERE candidate_memory.run_id=lineage.id AND candidate_memory.provenance=$2)
    )
    SELECT ref.storage_identity,ref.checksum FROM matching lineage JOIN agent_memory_entries memory ON memory.run_id=lineage.id
    JOIN agent_artifact_refs ref ON ref.memory_entry_id=memory.id
    LEFT JOIN candidate_domain_artifacts domain ON domain.run_id=memory.run_id AND domain.payload_ref=ref.storage_identity
    WHERE memory.provenance=$2 AND lineage.depth=(SELECT MIN(depth) FROM matching)
    ORDER BY lineage.depth,domain.created_at_utc NULLS LAST,ref.id`, [runId, provenance]);
  return rows.map((row) => ({ artifactRef: row.storage_identity, checksum: row.checksum }));
}

function stringItems(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) return [item.trim()];
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const label = [record.title, record.name, record.value, record.reason].find((entry) => typeof entry === "string" && entry.trim());
    return typeof label === "string" ? [label.trim()] : [];
  });
}

function explicitlyConfirmed(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === "object" && !Array.isArray(item)
    && ((item as Record<string, unknown>).confirmed === true
      || ["Подтверждено", "CONFIRMED", "positive"].includes(String((item as Record<string, unknown>).state ?? (item as Record<string, unknown>).status ?? ""))))
    .flatMap((item) => stringItems([item]));
}

function referencedFactIds(value: Record<string, unknown>, validFactIds: ReadonlySet<string>) {
  const candidates = [value.factId, ...(Array.isArray(value.factIds) ? value.factIds : []), ...(Array.isArray(value.evidenceFactIds) ? value.evidenceFactIds : [])];
  return [...new Set(candidates.filter((item): item is string => typeof item === "string" && validFactIds.has(item)))];
}

function assessmentState(value: Record<string, unknown>) {
  return String(value.state ?? value.status ?? "");
}

function groundedAssessmentItems(value: unknown, validFactIds: ReadonlySet<string>, options: { confirmedOnly?: boolean; insufficientWhenUngrounded?: boolean } = {}): Array<Record<string, unknown> & { factIds: string[] }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const factIds = referencedFactIds(record, validFactIds);
    const confirmed = ["Подтверждено", "CONFIRMED", "positive"].includes(assessmentState(record));
    if (options.confirmedOnly && (!confirmed || !factIds.length)) return [];
    if (!factIds.length && !options.insufficientWhenUngrounded) return [];
    return [{ ...record, factIds, ...(factIds.length ? {} : { state: "Недостаточно данных" }) }];
  });
}

export function groundStructuredAssessment(value: Record<string, unknown>, facts: readonly { id?: string }[], conflicts: readonly { factIds?: readonly string[]; resolved?: boolean }[] = []) {
  const validFactIds = new Set(facts.flatMap((fact) => typeof fact.id === "string" ? [fact.id] : []));
  const unresolvedConflictSets = conflicts.flatMap((conflict) => {
    const factIds = Array.isArray(conflict.factIds) ? conflict.factIds.filter((id) => typeof id === "string" && validFactIds.has(id)) : [];
    return conflict.resolved !== true && factIds.length >= 2 ? [new Set(factIds)] : [];
  });
  const observations = groundedAssessmentItems(value.observations, validFactIds, { insufficientWhenUngrounded: true });
  const abcEvidence = value.abcEvidence && typeof value.abcEvidence === "object" && !Array.isArray(value.abcEvidence)
    ? value.abcEvidence as Record<string, unknown> : {};
  const observationEvidence = new Map(observations.flatMap((item) => {
    const key = typeof item.criterionId === "string" ? item.criterionId : typeof item.directionId === "string" ? item.directionId : undefined;
    return key ? [[key, Array.isArray(item.factIds) ? item.factIds : []] as const] : [];
  }));
  const rawAbc = value.abcStates && typeof value.abcStates === "object" && !Array.isArray(value.abcStates) ? value.abcStates as Record<string, unknown> : {};
  const abcStates = Object.fromEntries(Object.entries(rawAbc).map(([key, state]) => {
    const evidenceRecord = abcEvidence[key] && typeof abcEvidence[key] === "object" && !Array.isArray(abcEvidence[key]) ? abcEvidence[key] as Record<string, unknown> : {};
    const factIds = [...referencedFactIds(evidenceRecord, validFactIds), ...(observationEvidence.get(key) ?? []).filter((item): item is string => typeof item === "string" && validFactIds.has(item))];
    const allowed = ["A", "B", "C", "CONFLICT", "Недостаточно данных"].includes(String(state));
    const hasGroundedConflict = unresolvedConflictSets.some((conflictFactIds) => factIds.filter((id) => conflictFactIds.has(id)).length >= 2);
    if (String(state) === "CONFLICT" && !hasGroundedConflict) throw new Error(`ABC_CONFLICT_EVIDENCE_REQUIRED:${key}`);
    if (factIds.length > 0 && String(state) === "Недостаточно данных") throw new Error(`ABC_EXACT_GRADE_REQUIRED:${key}`);
    return [key, allowed && (String(state) === "CONFLICT" || String(state) === "Недостаточно данных" || factIds.length > 0) ? String(state) : "Недостаточно данных"];
  }));
  return {
    ...value,
    observations,
    abcStates,
    competencies: groundedAssessmentItems(value.competencies, validFactIds, { insufficientWhenUngrounded: true }),
    accessToKe: groundedAssessmentItems(value.accessToKe, validFactIds, { insufficientWhenUngrounded: true }),
    risks: groundedAssessmentItems(value.risks, validFactIds),
    stopFactors: groundedAssessmentItems(value.stopFactors, validFactIds, { confirmedOnly: true }),
  };
}

export function validateAbcAssessmentSemantics(
  value: Record<string, unknown>,
  directions: readonly { id: string; gradeA?: string; gradeB?: string; gradeC?: string }[],
  validFactIds?: ReadonlySet<string>,
) {
  const states = value.abcStates && typeof value.abcStates === "object" && !Array.isArray(value.abcStates) ? value.abcStates as Record<string, unknown> : {};
  const evidence = value.abcEvidence && typeof value.abcEvidence === "object" && !Array.isArray(value.abcEvidence) ? value.abcEvidence as Record<string, unknown> : {};
  const expected = new Set(directions.map((direction) => direction.id));
  if (directions.length && (Object.keys(states).some((id) => !expected.has(id))
    || Object.keys(evidence).some((id) => !expected.has(id))
    || [...expected].some((id) => !(id in states) || !(id in evidence)))) throw new Error("ABC_DIRECTIONS_MISMATCH");
  for (const [directionId, rawGrade] of Object.entries(states)) {
    const grade = String(rawGrade);
    if (!["A", "B", "C"].includes(grade)) continue;
    const basis = evidence[directionId];
    if (!basis || typeof basis !== "object" || Array.isArray(basis)) throw new Error(`ABC_EVIDENCE_REQUIRED:${directionId}`);
    const basisFactIds = Array.isArray((basis as Record<string, unknown>).factIds) ? (basis as Record<string, unknown>).factIds as unknown[] : [];
    if (validFactIds && basisFactIds.some((id) => typeof id !== "string" || !validFactIds.has(id))) {
      throw new Error(`ABC_UNKNOWN_FACT_REFERENCE:${directionId}`);
    }
    const levels = (basis as Record<string, unknown>).levels;
    const direction = directions.find((item) => item.id === directionId);
    for (const levelGrade of ["A", "B", "C"] as const) {
      const level = levels && typeof levels === "object" && !Array.isArray(levels) ? (levels as Record<string, unknown>)[levelGrade] : undefined;
      const expectedDefinition = direction?.[`grade${levelGrade}`];
      if (!level || typeof level !== "object" || Array.isArray(level)
        || (expectedDefinition && String((level as Record<string, unknown>).definition).trim() !== expectedDefinition.trim())) {
        throw new Error(`ABC_LEVEL_DEFINITION_MISMATCH:${directionId}:${levelGrade}`);
      }
      const contradictionIds = Array.isArray((level as Record<string, unknown>).contradictingFactIds)
        ? (level as Record<string, unknown>).contradictingFactIds as unknown[] : [];
      if (validFactIds && contradictionIds.some((id) => typeof id !== "string" || !validFactIds.has(id))) {
        throw new Error(`ABC_UNKNOWN_FACT_REFERENCE:${directionId}`);
      }
    }
    const selected = levels && typeof levels === "object" && !Array.isArray(levels) ? (levels as Record<string, unknown>)[grade] : undefined;
    if (!selected || typeof selected !== "object" || Array.isArray(selected)) throw new Error(`ABC_LEVEL_COMPARISON_REQUIRED:${directionId}:${grade}`);
    const comparison = selected as Record<string, unknown>;
    const matched = Array.isArray(comparison.matchedConditions) ? comparison.matchedConditions : [];
    const missing = Array.isArray(comparison.missingConditions) ? comparison.missingConditions : [];
    const contradicted = Array.isArray(comparison.contradictingFactIds) ? comparison.contradictingFactIds : [];
    if (!matched.length || missing.length || contradicted.length) {
      const code = grade === "A" ? "ABC_GRADE_A_INCOMPLETE" : "ABC_SELECTED_GRADE_INCOMPLETE";
      throw new Error(`${code}:${directionId}`);
    }
    const higherGrades = grade === "B" ? ["A"] : grade === "C" ? ["A", "B"] : [];
    for (const higherGrade of higherGrades) {
      const higher = (levels as Record<string, unknown>)[higherGrade] as Record<string, unknown>;
      const higherMissing = Array.isArray(higher.missingConditions) ? higher.missingConditions : [];
      const higherContradictions = Array.isArray(higher.contradictingFactIds) ? higher.contradictingFactIds : [];
      if (!higherMissing.length && !higherContradictions.length) {
        throw new Error(`ABC_HIGHER_GRADE_ELIGIBLE:${directionId}:${higherGrade}`);
      }
    }
  }
  return value;
}

export function partitionEvidenceLocators(
  locators: Readonly<Record<string, EvidenceLocator>>,
  maximumBatches = 6,
  targetEntries = 20,
  targetBytes = 60_000,
) {
  const entries = Object.entries(locators);
  if (!entries.length) return [];
  const totalBytes = entries.reduce((sum, [, locator]) => sum + JSON.stringify(locator).length, 0);
  const batchCount = Math.min(maximumBatches, Math.max(
    1,
    Math.ceil(entries.length / targetEntries),
    Math.ceil(totalBytes / targetBytes),
  ));
  const batches = Array.from({ length: batchCount }, () => ({} as Record<string, EvidenceLocator>));
  const weights = Array.from({ length: batchCount }, () => 0);
  for (const [key, locator] of entries.sort((left, right) => JSON.stringify(right[1]).length - JSON.stringify(left[1]).length)) {
    const target = weights.indexOf(Math.min(...weights));
    batches[target][key] = locator;
    weights[target] += JSON.stringify(locator).length;
  }
  return batches.filter((batch) => Object.keys(batch).length > 0);
}

export function assessmentInputsFromStructured(value: Record<string, unknown>, conflictIds: readonly string[]): AssessmentInputs {
  const observations = Array.isArray(value.observations) ? value.observations.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
  const competencies = Array.isArray(value.competencies) ? value.competencies.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
  const accessToKe = Array.isArray(value.accessToKe) ? value.accessToKe.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
  const requiredAccessToKe = accessToKe.filter((item) => item.required === true);
  const abcSource = value.abcStates && typeof value.abcStates === "object" && !Array.isArray(value.abcStates) ? value.abcStates as Record<string, unknown> : {};
  const allowed = new Set(["A", "B", "C", "CONFLICT", "Недостаточно данных"]);
  const abcStates = Object.fromEntries(Object.entries(abcSource).map(([key, state]) => [key, allowed.has(String(state)) ? String(state) : "Недостаточно данных"])) as AssessmentInputs["abcStates"];
  const state = (item: Record<string, unknown>) => String(item.state ?? item.status ?? "");
  return {
    confirmedStopFactors: explicitlyConfirmed(value.stopFactors),
    requiredItemsInsufficient: [
      ...observations.filter((item) => item.required === true && ["Недостаточно данных", "INSUFFICIENT"].includes(state(item))),
      ...requiredAccessToKe.filter((item) => ["Недостаточно данных", "Противоречие источников", "INSUFFICIENT", "CONFLICT"].includes(state(item))),
    ].flatMap((item) => stringItems([item])),
    requiredExperienceConfirmed: observations.some((item) => String(item.category ?? "") === "required-experience" && ["Подтверждено", "CONFIRMED"].includes(state(item))),
    accessToKePositive: requiredAccessToKe.length > 0 && requiredAccessToKe.every((item) => ["Подтверждено", "CONFIRMED"].includes(state(item))),
    unresolvedConflicts: [...conflictIds],
    limitations: observations.filter((item) => ["Недостаточно данных", "INSUFFICIENT"].includes(state(item))).flatMap((item) => stringItems([item])),
    risks: stringItems(value.risks),
    partiallyConfirmedCompetencies: competencies.filter((item) => ["Частично подтверждено", "PARTIAL"].includes(state(item))).flatMap((item) => stringItems([item])),
    abcStates,
  };
}

type PinnedInputSnapshotRow = { snapshot_id: string; manifest_json: string; state: string };

export async function resolvePinnedRunInputSnapshot(input: {
  folderId: string;
  inputVersion: string;
  load: () => Promise<PinnedInputSnapshotRow | undefined>;
}) {
  const row = await input.load();
  if (!row) throw new Error("CANDIDATE_INPUT_VERSION_NOT_FOUND");
  if (row.state !== "MATERIALS_READY") throw new Error("CANDIDATE_INPUT_VERSION_NOT_READY");
  let manifest: ReturnType<typeof classifyMaterials>;
  try { manifest = JSON.parse(row.manifest_json) as ReturnType<typeof classifyMaterials>; }
  catch { throw new Error("CANDIDATE_INPUT_MANIFEST_INVALID"); }
  if (!manifest.complete || !Array.isArray(manifest.entries)) throw new Error("CANDIDATE_INPUT_MANIFEST_INVALID");
  return Object.freeze({ folderId: input.folderId, objects: structuredClone(manifest.entries), snapshotId: row.snapshot_id, manifest: structuredClone(manifest), inputVersion: input.inputVersion });
}

function loopbackOrDockerHostname(hostname: string): boolean {
  if (/^(localhost|127\.0\.0\.1)$/i.test(hostname)) return true;
  return process.env.HH_DOCKER_NETWORK === "1";
}

function dockerInternalProcessorEndpoint(url: URL, service: "document-processor" | "media-processor") {
  const expected = service === "document-processor"
    ? { port: "4312", path: "/v1/extract-document" }
    : { port: "4311", path: "/v1/extract-audio" };
  return process.env.HH_DOCKER_NETWORK === "1"
    && url.protocol === "http:"
    && url.hostname === service
    && url.port === expected.port
    && url.pathname === expected.path
    && !url.username
    && !url.password
    && !url.search
    && !url.hash;
}

export async function createProductionCandidateToolExecution(input: { database: PostgresClient; environment: ExecutionEnvironment; task: Record<string, unknown> }) {
  const candidatePk = integer(input.task.candidatePk, "PRODUCTION_TASK_CANDIDATE_PK_MISSING");
  const candidate = await queryOne<{ public_id: string | null; drive_folder_id: string }>(input.database,
    `SELECT c.public_id,f.drive_folder_id FROM candidates c
      JOIN candidate_drive_folders f ON f.candidate_id=c.id WHERE c.id=$1`, [candidatePk]);
  if (!candidate) throw new Error("CANDIDATE_DRIVE_FOLDER_NOT_REGISTERED");
  const task: Record<string, unknown> = { ...input.task, candidateId: candidate.public_id ?? String(candidatePk), candidateFolderId: candidate.drive_folder_id };
  const oauth = createGoogleDriveOAuthRuntime({ database: input.database, environment: input.environment });
  const status = await oauth.repository.getConnection();
  if (!status || status.state !== "CONNECTED") throw new Error("GOOGLE_DRIVE_REAUTH_REQUIRED");
  const drive = await oauth.drive();
  const artifactStore = new PostgresCandidateArtifactStore(new PostgresBlobStore(input.database));
  const agentRuntime = new PostgresAgentRuntimeRepository(input.database);
  const goal = await queryOne<{ goal_id: string; workflow_version: string; trigger_identity: string }>(input.database, "SELECT goal_id,workflow_version,trigger_identity FROM agent_runs WHERE id=$1", [task.runId]);
  if (!goal) throw new Error("PRODUCTION_RUN_NOT_FOUND");
  if (goal.workflow_version !== MATRIX_WORKFLOW_VERSION) throw new Error("UNSUPPORTED_CANDIDATE_WORKFLOW_VERSION");
  const taskId = text(task.id, "PRODUCTION_TASK_ID_MISSING");
  const attemptId = text(task.attemptId, "PRODUCTION_TASK_ATTEMPT_ID_MISSING");
  const worker = text(task.worker, "PRODUCTION_TASK_WORKER_MISSING");
  const leaseToken = integer(task.leaseToken, "PRODUCTION_TASK_LEASE_TOKEN_MISSING");
  const grantId = text(task.authorizationGrantId, "PRODUCTION_TASK_GRANT_MISSING");
  const operationIdentity = text(task.idempotencyIdentity, "PRODUCTION_TASK_IDEMPOTENCY_IDENTITY_MISSING");
  const runId = text(task.runId, "PRODUCTION_TASK_RUN_ID_MISSING");
  const inputVersion = text(task.inputVersion, "PRODUCTION_TASK_INPUT_VERSION_MISSING");
  const profileVersion = text(task.profileVersion, "PRODUCTION_TASK_PROFILE_VERSION_MISSING");
  const benchmarkGuard = await queryOne<{ deny_checksums_json: string }>(input.database,
    "SELECT deny_checksums_json FROM private_benchmark_guards WHERE run_id=$1", [runId]);
  const deniedBenchmarkChecksums = new Set<string>(benchmarkGuard ? JSON.parse(benchmarkGuard.deny_checksums_json) as string[] : []);
  const auditBoundary = async (boundary: "drive" | "provider" | "blob", bytes: Uint8Array) => {
    if (!benchmarkGuard) return;
    const checksum = createHash("sha256").update(bytes).digest("hex");
    if (deniedBenchmarkChecksums.has(checksum)) throw new Error(`PRIVATE_BENCHMARK_REFERENCE_DENIED:${boundary}`);
    await execute(input.database, `INSERT INTO private_benchmark_boundary_audits(run_id,boundary,payload_checksum,created_at_utc)
      VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [runId, boundary, checksum, new Date().toISOString()]);
  };
  const traceCorrelation = (stage: string, suffix = "main"): TraceCorrelation => ({
    traceId: `trace-${sha256([runId, taskId, attemptId, stage, suffix]).slice(0, 32)}`,
    callId: `call-${sha256([taskId, attemptId, stage, suffix]).slice(0, 24)}`,
    attemptId,
    attemptNumber: Math.max(1, Number(task.attemptNumber ?? 1)),
    workflowRunId: runId,
    workflowStage: stage,
    candidateId: candidate.public_id ?? String(candidatePk),
    inputVersion,
    profileVersion,
  });
  const llmBudget: CapabilityBudget = {
    async reserve(amount) {
      const requested = Object.entries(amount).filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0);
      if (!requested.length) return;
      await withTransaction(input.database, async (transaction) => {
        for (const [kind, units] of requested) {
          const updated = await execute(transaction,
            "UPDATE agent_budget_ledger SET used_value=used_value+$1,revision=revision+1 WHERE run_id=$2 AND kind=$3 AND used_value+$1<=limit_value",
            [units, runId, kind]);
          if (updated !== 1) throw new Error("BUDGET_DENIED:llmCalls");
        }
      });
    },
    commit() {},
    async release(amount) {
      const requested = Object.entries(amount).filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0);
      if (requested.length) await withTransaction(input.database, async (transaction) => {
        for (const [kind, units] of requested) await execute(transaction,
          "UPDATE agent_budget_ledger SET used_value=GREATEST(0,used_value-$1),revision=revision+1 WHERE run_id=$2 AND kind=$3",
          [units, runId, kind]);
      });
    },
  };
  const providerAdapter = new OpenAiCompatibleProviderAdapter();
  const llmDependencies: ExecuteLlmAttemptDependencies = {
    configuration: loadRuntimeConfiguration(input.environment, [
      "ocr",
      "matrix_compiler",
      "matrix_critic",
      "criterion_claim_extraction",
      "unmapped_signal_discovery",
      "evidence_consolidation",
      "global_conflict_detection",
      "matrix_row_evaluation",
      "abc_matrix_assessment",
      "critical_row_verification",
      "candidate_report_composer",
    ]),
    adapter: {
      execute: async (request) => {
        const safeRequest = { ...request, credential: "[server-secret-redacted]" };
        try { await auditBoundary("provider", new TextEncoder().encode(JSON.stringify(safeRequest))); }
        catch (error) { throw safeCandidateStageError(error, "PROVIDER_BOUNDARY_AUDIT_FAILED"); }
        try { return await providerAdapter.execute(request); }
        catch (error) {
          if (error instanceof LlmProviderAttemptError) throw error;
          throw safeCandidateStageError(error, "ROUTERAI_PROVIDER_CALL_FAILED");
        }
      },
    },
    protectedStore: new AdminOnlyProtectedTraceStore(new PostgresProtectedTracePersistence(new PostgresBlobStore(input.database))),
    incidents: {
      async record(incident) {
        const sequence = (await queryOne<{ next_sequence: number }>(input.database,
          "SELECT COALESCE(MAX(sequence),0)+1 AS next_sequence FROM agent_events WHERE run_id=$1", [runId]))?.next_sequence ?? 1;
        await execute(input.database, `INSERT INTO agent_events
          (id,run_id,sequence,event_identity,type,actor,plan_version,task_id,safe_payload_json,created_at)
          VALUES ($1,$2,$3,$4,'PROTECTED_TRACE_INCOMPLETE','runtime',(SELECT current_plan_version FROM agent_runs WHERE id=$2),$5,$6,$7)
          ON CONFLICT DO NOTHING`, [crypto.randomUUID(), runId, sequence, `trace-incomplete:${incident.traceId}`, taskId,
          JSON.stringify({ traceId: incident.traceId, capability: incident.capability, incompleteTracing: true }), incident.occurredAt]);
      },
    },
  };
  const checkpoint = (value: { kind: string; identity: string; remoteJobId?: string; artifactIdentity?: string; checksum?: string }) => agentRuntime.checkpoint({
    attemptId, taskId, worker, leaseToken, ...value,
  });
  const authorizeFile = async (operation: string, fileId: string) => {
    const authorization = await agentRuntime.authorizeDriveResource({ taskId, grantId, operation, fileId, now: Date.now() });
    if (!authorization.allowed || Number(authorization.candidateId) !== candidatePk || authorization.inputVersion !== task.inputVersion) {
      throw new Error(authorization.code ?? "GOOGLE_DRIVE_ROOT_OR_GRANT_DENIED");
    }
  };
  const prepareDriveEffect = async (operation: string, identity: string) => agentRuntime.prepareExternalEffect({
    taskId, attemptId, worker, leaseToken, grantId, operation, operationIdentity: identity,
    sideEffectClass: "reversible-write", now: Date.now(),
  });
  const materialManifest = async () => {
    const row = await queryOne<{ manifest_json: string }>(input.database,
      "SELECT manifest_json FROM candidate_input_versions WHERE id=$1 AND candidate_id=$2", [task.inputVersion, candidatePk]);
    if (!row) throw new Error("CANDIDATE_INPUT_VERSION_NOT_FOUND");
    return JSON.parse(row.manifest_json) as {
      entries?: Array<DriveObject & { role?: string; supported?: boolean; interviewSource?: "recording" | "ready-transcript" }>;
    };
  };
  const immutableFileChecksum = async (fileId: string) => {
    return (await queryOne<{ checksum: string }>(input.database, `SELECT checkpoint.checksum
      FROM agent_checkpoints checkpoint
      JOIN agent_attempts attempt ON attempt.id=checkpoint.attempt_id
      JOIN agent_tasks source_task ON source_task.id=attempt.task_id
      JOIN agent_runs source_run ON source_run.id=source_task.run_id
      JOIN agent_goals source_goal ON source_goal.id=source_run.goal_id
      WHERE source_goal.candidate_id=$1 AND source_goal.input_version=$2
        AND checkpoint.kind='drive-download' AND checkpoint.checksum IS NOT NULL
        AND checkpoint.artifact_identity LIKE ($3 || ':%')
      ORDER BY checkpoint.created_at DESC LIMIT 1`, [candidatePk, inputVersion, fileId]))?.checksum;
  };
  const latestArtifact = async (provenance: string) => {
    const reference = await latestDomainArtifactReference(input.database, runId, provenance);
    if (!reference) throw new Error("UPSTREAM_ARTIFACT_MISSING");
    return reference;
  };
  const artifactsFor = async (provenance: string) => {
    return domainArtifactReferences(input.database, runId, provenance);
  };
  const storeJson = async (kind: string, identity: string, value: unknown) => {
    if (!artifactStore) throw new Error("PRODUCTION_ARTIFACT_STORE_NOT_PROVISIONED");
    await auditBoundary("blob", new TextEncoder().encode(JSON.stringify(value)));
    const stored = await artifactStore.putJson({ candidatePk, runId, kind, identity, value });
    const domainArtifactId = `domain-artifact-${sha256([candidatePk, kind, stored.checksum]).slice(0, 24)}`;
    await execute(input.database, `INSERT INTO candidate_domain_artifacts
      (id,candidate_id,run_id,input_version_id,profile_version,kind,schema_version,provider,tool_version,config_fingerprint,checksum,payload_ref,created_at_utc)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`, [domainArtifactId, candidatePk, runId, inputVersion, profileVersion, kind,
        `${kind}/v1`, kind.includes("document") ? "local-extraction" : "routerai", String(task.toolKey ?? "candidate-pipeline/v1"),
        sha256([input.environment.CANDIDATE_PIPELINE_BUILD_ID, input.environment.LLM_RUNTIME_CONFIG_JSON]), stored.checksum, stored.artifactRef, new Date().toISOString()]);
    return { ...stored, domainArtifactId };
  };
  const storeBytes = async (kind: string, identity: string, bytes: Uint8Array, contentType: string) => {
    if (!artifactStore) throw new Error("PRODUCTION_ARTIFACT_STORE_NOT_PROVISIONED");
    await auditBoundary("blob", bytes);
    const stored = await artifactStore.putBytes({ candidatePk, runId, kind, identity, bytes, contentType });
    const domainArtifactId = `domain-artifact-${sha256([candidatePk, kind, stored.checksum]).slice(0, 24)}`;
    await execute(input.database, `INSERT INTO candidate_domain_artifacts
      (id,candidate_id,run_id,input_version_id,profile_version,kind,schema_version,provider,tool_version,config_fingerprint,checksum,payload_ref,created_at_utc)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`, [domainArtifactId, candidatePk, runId, inputVersion, profileVersion, kind,
        `${kind}/v1`, "node-pdf-renderer", String(task.toolKey ?? "candidate-pipeline/v1"),
        sha256([input.environment.CANDIDATE_PIPELINE_BUILD_ID, input.environment.LLM_RUNTIME_CONFIG_JSON]), stored.checksum, stored.artifactRef, new Date().toISOString()]);
    return { ...stored, domainArtifactId };
  };
  const vacancyContext = async () => {
    const candidateRecord = JSON.parse((await queryOne<{ record_json: string }>(input.database,
      "SELECT record_json FROM candidates WHERE id=$1", [candidatePk]))?.record_json ?? "{}") as Record<string, unknown>;
    const vacancyId = typeof candidateRecord.vacancyId === "string" ? candidateRecord.vacancyId : undefined;
    const vacancy = vacancyId ? await queryOne<{ record_json: string }>(input.database,
      "SELECT record_json FROM vacancies WHERE id=$1", [vacancyId]) : null;
    return { candidate: candidateRecord, vacancy: vacancy?.record_json ? JSON.parse(vacancy.record_json) as Record<string, unknown> : null, profileVersion };
  };
  let publicationDirectory: { reportVersionId: string; versionFolderId: string } | undefined;
  const ensurePublicationDirectory = async () => {
    if (publicationDirectory) return publicationDirectory;
    const version = await queryOne<{ id: string; analysis_version: number; directory_identity: string }>(input.database,
      `WITH RECURSIVE run_lineage(id,depth) AS (
        SELECT $1::text,0 UNION ALL SELECT source.recovery_source_run_id,lineage.depth+1
        FROM agent_runs source JOIN run_lineage lineage ON source.id=lineage.id
        WHERE source.recovery_source_run_id IS NOT NULL AND lineage.depth<32
      ) SELECT version.id,version.analysis_version,version.directory_identity FROM candidate_report_versions version
      JOIN run_lineage lineage ON lineage.id=version.run_id
      WHERE version.candidate_id=$2 AND version.state IN ('VALIDATED_REPORT','VALIDATED_PAIR','PUBLISHED')
      ORDER BY lineage.depth,version.analysis_version DESC LIMIT 1`, [runId, candidatePk]);
    if (!version) throw new Error("REPORT_VERSION_NOT_READY_FOR_PUBLICATION");
    await authorizeFile("ensure-folder", candidate.drive_folder_id);
    await prepareDriveEffect("ensure-folder", `candidate:${candidatePk}:results`);
    const resultsFolder = await drive.ensureFolder({ name: "Результаты", parentFolderId: candidate.drive_folder_id,
      operationIdentity: `candidate:${candidatePk}:results` });
    await authorizeFile("ensure-folder", resultsFolder.id);
    await prepareDriveEffect("ensure-folder", version.directory_identity);
    const versionFolder = await drive.ensureFolder({ name: `v${String(version.analysis_version).padStart(4, "0")}`, parentFolderId: resultsFolder.id,
      operationIdentity: version.directory_identity });
    publicationDirectory = { reportVersionId: version.id, versionFolderId: versionFolder.id };
    return publicationDirectory;
  };

  const runtime: ProductionRuntime = {
    repository: {
      async assertGrant(grantId, scope) {
        const authorization = await agentRuntime.authorizeDriveResource({ taskId: text(task.id, "PRODUCTION_TASK_ID_MISSING"), grantId,
          operation: "list", fileId: candidate.drive_folder_id, now: Date.now() });
        return authorization.allowed === true
          && authorization.connectionId === status.id
          && authorization.rootFolderId === status.rootFolderId
          && Number(authorization.candidateId) === candidatePk
          && authorization.inputVersion === task.inputVersion
          && scope.candidateFolderId === candidate.drive_folder_id;
      },
      async checkpoint(value) {
        await agentRuntime.checkpoint({
          attemptId,
          taskId,
          worker,
          leaseToken,
          kind: text(value.kind, "PRODUCTION_CHECKPOINT_KIND_MISSING"),
          identity: text(value.identity, "PRODUCTION_CHECKPOINT_IDENTITY_MISSING"),
          artifactIdentity: typeof value.artifactRef === "string" ? value.artifactRef : undefined,
          remoteJobId: typeof value.remoteJobId === "string" ? value.remoteJobId : undefined,
        });
      },
      async artifactReference(value) {
        const storageIdentity = value.artifactRef;
        const storageClass = storageIdentity.startsWith("pgblob://") ? "postgres-blob" : "drive";
        const checksum = value.checksum ?? sha256(storageIdentity);
        const memoryId = `memory-${sha256([String(task.runId), storageIdentity]).slice(0, 24)}`;
        const refId = `artifact-ref-${sha256([storageIdentity, checksum]).slice(0, 24)}`;
        const recoverySchema = recoveryArtifactSchema(goal.workflow_version, String(task.toolKey));
        const artifactPurpose = recoverySchema ? recoveryArtifactPurpose(goal.workflow_version) : "candidate-pipeline-stage";
        await withTransaction(input.database, async (transaction) => {
          await execute(transaction, `INSERT INTO agent_memory_entries
            (id,goal_id,run_id,candidate_id,input_version,profile_version,kind,provenance,sensitivity,purpose,payload_json,immutable)
            VALUES ($1,$2,$3,$4,$5,$6,'artifact',$7,'personal',$8,NULL,true) ON CONFLICT DO NOTHING`,
          [memoryId, goal.goal_id, task.runId, candidatePk, task.inputVersion, task.profileVersion, task.toolKey, artifactPurpose]);
          await execute(transaction, `INSERT INTO agent_artifact_refs
            (id,memory_entry_id,storage_class,storage_identity,checksum,schema_version) VALUES ($1,$2,$3,$4,$5,$6)
            ON CONFLICT DO NOTHING`, [refId, memoryId, storageClass, storageIdentity, checksum, recoverySchema ?? "reference/v1"]);
        });
      },
      async outboxIntent(value) {
        const operationIdentity = text(value.operationIdentity, "PRODUCTION_OUTBOX_IDENTITY_MISSING");
        const kind = String(value.kind ?? "external-effect");
        const sideEffect = kind === "telegram" ? "irreversible-write" : "reversible-write";
        await execute(input.database, `INSERT INTO agent_outbox
          (id,run_id,operation_identity,side_effect_class,state,payload_ref,attempts,unknown_outcome,created_at)
          VALUES ($1,$2,$3,$4,'PENDING',$5,0,false,$6) ON CONFLICT DO NOTHING`, [crypto.randomUUID(), task.runId, operationIdentity, sideEffect,
          typeof value.artifactRef === "string" ? value.artifactRef : `task:${task.id}`, new Date().toISOString()]);
      },
      async waitForHuman(value) {
        await agentRuntime.waitForHuman({ taskId, attemptId,
          worker, leaseToken,
          obstacle: String(value.obstacle ?? "GOOGLE_OAUTH_INVALID_GRANT"), action: String(value.action ?? "Переподключить Google Drive"), now: Date.now() });
      },
    },
    oauth: { connectionId: status.id, rootFolderId: status.rootFolderId, accessToken: () => oauth.tokenProvider.accessToken() },
    adapters: {
      drive: {
        snapshot: async (folderId) => resolvePinnedRunInputSnapshot({ folderId, inputVersion, load: () => queryOne<PinnedInputSnapshotRow>(input.database,
          "SELECT snapshot_id,manifest_json,state FROM candidate_input_versions WHERE id=$1 AND candidate_id=$2", [inputVersion, candidatePk]) }),
        publishPdf: async (value) => {
          if (!artifactStore) throw new Error("PRODUCTION_REPORT_ARTIFACT_STORE_NOT_PROVISIONED");
          const artifactRef = text(value.artifactRef, "REPORT_ARTIFACT_REF_MISSING");
          const type = text(value.type, "REPORT_TYPE_MISSING");
          const expectedChecksum = text(value.checksum, "REPORT_CHECKSUM_MISSING");
          const effectIdentity = text(value.operationIdentity, "REPORT_OPERATION_IDENTITY_MISSING");
          const directory = await ensurePublicationDirectory();
          await authorizeFile("publish", directory.versionFolderId);
          await prepareDriveEffect("publish", effectIdentity);
          const descriptor = await queryOne<{ id: string; file_name: string; checksum: string }>(input.database,
            "SELECT id,file_name,checksum FROM candidate_report_documents WHERE report_version_id=$1 AND type=$2",
            [directory.reportVersionId, type]);
          if (!descriptor || descriptor.checksum !== expectedChecksum) throw new Error("REPORT_PUBLICATION_DESCRIPTOR_MISMATCH");
          const bytes = await artifactStore.getBytes(artifactRef);
          if (sha256(bytes) !== expectedChecksum) throw new Error("REPORT_PUBLICATION_CHECKSUM_MISMATCH");
          await auditBoundary("drive", bytes);
          const published = await drive.publishPdf({ parentFolderId: directory.versionFolderId, fileName: descriptor.file_name,
            bytes, checksum: expectedChecksum, operationIdentity: effectIdentity });
          await execute(input.database,
            "UPDATE candidate_report_documents SET drive_file_id=$1 WHERE id=$2 AND (drive_file_id IS NULL OR drive_file_id=$1)", [published.id, descriptor.id]);
          const publishedDocuments = await queryOne<{ count: string; required_count: string }>(input.database,
            "SELECT COUNT(*) FILTER (WHERE drive_file_id IS NOT NULL) AS count,COUNT(*) AS required_count FROM candidate_report_documents WHERE report_version_id=$1", [directory.reportVersionId]);
          if (Number(publishedDocuments?.count) === Number(publishedDocuments?.required_count) && Number(publishedDocuments?.count) > 0) await withTransaction(input.database, async (transaction) => {
            await execute(transaction, "UPDATE candidate_report_versions SET state='PUBLISHED' WHERE id=$1 AND state IN ('VALIDATED_REPORT','VALIDATED_PAIR')", [directory.reportVersionId]);
            await execute(transaction,
              `UPDATE candidates SET revision=revision+1,record_json=(record_json::jsonb || '{"status":"READY"}'::jsonb)::text WHERE id=$1`, [candidatePk]);
          });
          return { fileId: published.id, checksum: published.checksum };
        },
        reconcile: async (identity) => {
          const type = identity.endsWith(":candidate-report") ? "candidate-report" : undefined;
          if (type) {
            const descriptor = await queryOne<{ id: string; checksum: string; report_version_id: string; drive_file_id: string | null }>(input.database, `WITH RECURSIVE run_lineage(id,depth) AS (
                SELECT $1::text,0 UNION ALL SELECT source.recovery_source_run_id,lineage.depth+1
                FROM agent_runs source JOIN run_lineage lineage ON source.id=lineage.id
                WHERE source.recovery_source_run_id IS NOT NULL AND lineage.depth<32
              ) SELECT document.id,document.checksum,document.report_version_id,document.drive_file_id
              FROM candidate_report_documents document JOIN candidate_report_versions version ON version.id=document.report_version_id
              JOIN run_lineage lineage ON lineage.id=version.run_id
              WHERE version.candidate_id=$2 AND document.type=$3
              ORDER BY lineage.depth,version.analysis_version DESC LIMIT 1`, [runId, candidatePk, type]);
            if (descriptor?.drive_file_id) return { fileId: descriptor.drive_file_id, checksum: descriptor.checksum };
            const existing = await oauth.repository.findByOperationIdentity(status.id, identity);
            if (!existing) return null;
            if (!descriptor || descriptor.checksum !== existing.checksum) throw new Error("REPORT_RECONCILIATION_DESCRIPTOR_MISMATCH");
            await execute(input.database,
              "UPDATE candidate_report_documents SET drive_file_id=$1 WHERE id=$2 AND (drive_file_id IS NULL OR drive_file_id=$1)", [existing.fileId, descriptor.id]);
            const publishedDocuments = await queryOne<{ count: string; required_count: string }>(input.database,
              "SELECT COUNT(*) FILTER (WHERE drive_file_id IS NOT NULL) AS count,COUNT(*) AS required_count FROM candidate_report_documents WHERE report_version_id=$1", [descriptor.report_version_id]);
            if (Number(publishedDocuments?.count) === Number(publishedDocuments?.required_count) && Number(publishedDocuments?.count) > 0) await withTransaction(input.database, async (transaction) => {
              await execute(transaction, "UPDATE candidate_report_versions SET state='PUBLISHED' WHERE id=$1 AND state IN ('VALIDATED_REPORT','VALIDATED_PAIR')", [descriptor.report_version_id]);
              await execute(transaction, `UPDATE candidates SET revision=revision+1,
                record_json=(record_json::jsonb || '{"status":"READY"}'::jsonb)::text
                WHERE id=$1 AND record_json::jsonb->>'status'!='READY'`, [candidatePk]);
            });
            return { fileId: existing.fileId, checksum: existing.checksum };
          }
          return null;
        },
      },
      routerAI: {
        invoke: async (value) => {
          if (!llmDependencies || !artifactStore) throw new Error("PRODUCTION_ROUTERAI_STAGE_CONTEXT_NOT_PROVISIONED");
          const capability = text(value.capability, "PRODUCTION_ROUTERAI_CAPABILITY_MISSING");
          if (capability === "ocr") {
            const manifest = await materialManifest();
            const documents = (manifest.entries ?? []).filter((entry) => entry.supported !== false
              && entry.role !== "interview"
              && ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword"].includes(entry.mimeType));
            if (!documents.length) throw new Error("DOCUMENT_MATERIAL_NOT_FOUND");
            const budgetedOcrDependencies: ExecuteLlmAttemptDependencies = {
              ...llmDependencies,
              adapter: {
                execute: async (request) => {
                  await llmBudget.reserve({ llmCalls: 1, externalRequests: 1 });
                  return llmDependencies.adapter.execute(request);
                },
              },
            };
            const ocr = new RouterAiPageOcrAdapter(budgetedOcrDependencies, ({ fileId, fileVersion, page }) => traceCorrelation("document-ocr", `${fileId}:${fileVersion}:${page}`));
            const processedDocuments: Array<{ artifactId: string; file: typeof documents[number]; processed: ProcessedDocument }> = [];
            for (const document of documents) {
              if (!input.environment.DOCUMENT_PROCESSOR_URL || !input.environment.DOCUMENT_PROCESSOR_TOKEN) throw new Error("PRODUCTION_DOCUMENT_PROCESSOR_NOT_PROVISIONED");
              await authorizeFile("download", document.fileId);
              const expectedChecksum = await immutableFileChecksum(document.fileId);
              const downloaded = await drive.downloadVersion({
                fileId: document.fileId,
                expectedVersion: document.version,
                expectedSize: document.size,
                expectedModifiedTime: document.modifiedTime,
                expectedChecksum,
                checkpoint: (entry) => checkpoint({ kind: "drive-download", identity: `${operationIdentity}:${document.fileId}`,
                  artifactIdentity: `${entry.fileId}:${entry.version}`, checksum: entry.checksum }),
              });
              const processorUrl = new URL(input.environment.DOCUMENT_PROCESSOR_URL);
              if (input.environment.E2E_ENVIRONMENT === "local") {
                if (!loopbackOrDockerHostname(processorUrl.hostname) || !["http:", "https:"].includes(processorUrl.protocol)) throw new Error("LOCAL_DOCUMENT_PROCESSOR_MUST_BE_LOOPBACK");
              } else if (processorUrl.protocol !== "https:" && !dockerInternalProcessorEndpoint(processorUrl, "document-processor")) throw new Error("REMOTE_DOCUMENT_PROCESSOR_MUST_USE_HTTPS");
              await auditBoundary("provider", downloaded.bytes);
              const extractionResponse = await fetch(processorUrl, { method: "POST",
                headers: { authorization: `Bearer ${input.environment.DOCUMENT_PROCESSOR_TOKEN}`, "content-type": document.mimeType },
                body: downloaded.bytes.slice().buffer as ArrayBuffer, signal: AbortSignal.timeout(5 * 60_000) });
              const extracted = await extractionResponse.json() as { code?: string; kind?: string; pages?: ExtractedPage[]; sections?: ExtractedSection[] };
              if (!extractionResponse.ok) throw new Error(extracted.code ?? `DOCUMENT_PROCESSOR_HTTP_${extractionResponse.status}`);
              const processed = await processDocument({ mimeType: document.mimeType, fileId: document.fileId, fileVersion: document.version,
                bytes: downloaded.bytes,
                pdf: { extract: async () => extracted.kind === "pdf" && Array.isArray(extracted.pages) ? extracted.pages : Promise.reject(new Error("DOCUMENT_PROCESSOR_PDF_OUTPUT_INVALID")) },
                docx: { extract: async () => ["docx", "doc"].includes(String(extracted.kind)) && Array.isArray(extracted.sections) ? extracted.sections : Promise.reject(new Error("DOCUMENT_PROCESSOR_WORD_OUTPUT_INVALID")) },
                ocr });
              processedDocuments.push({ artifactId: `document-${sha256([document.fileId, document.version, processed.raw.checksum]).slice(0, 24)}`,
                file: document, processed });
            }
            const stored = await storeJson("document-bundle", operationIdentity, {
              schemaVersion: "document-bundle/v1",
              inputVersion,
              documents: processedDocuments,
            });
            return { artifactRef: stored.artifactRef, schemaVersion: "document-bundle/v1" };
          }

          throw new Error(`PRODUCTION_ROUTERAI_CAPABILITY_UNSUPPORTED:${capability}`);
        },
      },
      matrix: {
        execute: async (toolKey) => {
          if (!llmDependencies || !artifactStore) throw new Error("MATRIX_RUNTIME_NOT_PROVISIONED");
          const matrixRepository = new PostgresVacancyMatrixRepository(input.database, goal.workflow_version);
          const call = async (capability: MatrixCapability, context: Record<string, unknown>, suffix: string) => {
            const correlation = traceCorrelation(capability, suffix);
            const config = llmDependencies.configuration.resolve(capability);
            const attempt = await runLlmCapabilityWithPolicy(llmDependencies, llmBudget, {
              capability,
              correlation,
              request: { messages: [
                { role: "system", content: config.prompt.template },
                { role: "user", content: context },
              ] as JsonValue[], toolDefinitions: [] },
              inputSnapshot: { materials: [], context: JSON.parse(JSON.stringify(context)) as JsonValue },
            });
            return { output: normalizeMatrixCapabilityOutput(capability, attempt.response.normalizedOutput), traceRef: correlation.traceId, model: config.actualModel };
          };
          const profileContext = await vacancyContext();
          const vacancy = profileContext.vacancy ?? {};
          const sourceFragments: Record<string, string> = {};
          const collect = (value: unknown, path: string) => {
            if (typeof value === "string" && value.trim()) sourceFragments[path] = value;
            else if (Array.isArray(value)) value.forEach((item, index) => collect(item, `${path}[${index}]`));
            else if (value && typeof value === "object") Object.entries(value as Record<string, unknown>).forEach(([key, item]) => collect(item, path ? `${path}.${key}` : key));
          };
          collect(vacancy, "vacancy");
          if (toolKey === "candidate.matrix-compile/v1") {
            const skills: MatrixCompilationSkills = {
              async compile(value) {
                const result = await call("matrix_compiler", { profileVersion: value.profileVersion, canonicalProfile: value.canonicalProfile, sourceFragments: value.sourceFragments }, "compile");
                return { schemaVersion: "vacancy-matrix-draft/v1", criteria: result.output.criteria as never, traceRef: result.traceRef, model: result.model };
              },
              async critique(value) {
                const result = await call("matrix_critic", { profileVersion: value.profileVersion, canonicalProfile: value.canonicalProfile, sourceFragments: value.sourceFragments, draft: value.draft, policy: value.policy }, "critic-editor");
                return { schemaVersion: "vacancy-matrix-critic/v2", decision: result.output.decision as "PASS" | "CORRECTED", changes: result.output.changes as never,
                  successor: result.output.successor as never, traceRef: result.traceRef, model: result.model };
              },
            };
            const result = await compileVacancyMatrix({ profileVersion, ownerId: runId, canonicalProfile: vacancy, sourceFragments, compilerPolicyVersion: "matrix-compiler-policy/coverage-first-v1", skills, store: matrixRepository,
              allowRetry: goal.trigger_identity.startsWith("manual-reprocess:") });
            if (result.state === "WAITING") throw new Error("MATRIX_COMPILATION_WAITING");
            if (result.state === "FAILED") throw new Error(result.errorCode);
            const stored = await storeJson("vacancy-matrix-run-ref", operationIdentity, { schemaVersion: "vacancy-matrix-run-ref/v1", matrixId: result.matrixId, checksum: result.checksum, workflowVersion: MATRIX_WORKFLOW_VERSION,
              sameModelCritic: result.sameModelCritic, criticFallback: result.criticFallback ?? false,
              warnings: result.criticFallback ? ["MATRIX_CRITIC_UNAVAILABLE_COMPILER_DRAFT_PUBLISHED"] : [] });
            return { artifactRef: stored.artifactRef, checksum: result.checksum, state: result.state };
          }
          const published = await matrixRepository.readMatrix(profileVersion);
          if (!published) throw new Error("MATRIX_NOT_PUBLISHED");
          const matrix = published.matrix;
          if (toolKey === "candidate.matrix-context-search/v1") {
            const [documentRef, transcriptRef] = await Promise.all([latestArtifact("candidate.document-extraction/v1"), latestArtifact("candidate.transcription/v1")]);
            const stored = await storeJson("matrix-context-index", operationIdentity, { schemaVersion: "matrix-context-index/v1", documentRef, transcriptRef, scope: { candidateId: candidatePk, runId, inputVersion, profileVersion } });
            return { artifactRef: stored.artifactRef, checksum: stored.checksum };
          }
          if (toolKey === "candidate.matrix-context-read/v1") {
            const indexRef = await latestArtifact("candidate.matrix-context-search/v1");
            const index = await artifactStore.getJson<{ documentRef?: string; transcriptRef?: string }>(indexRef);
            if (!index.documentRef || !index.transcriptRef) throw new Error("MATRIX_CONTEXT_INDEX_INVALID");
            const [documents, transcript] = await Promise.all([artifactStore.getJson<unknown>(index.documentRef), artifactStore.getJson<unknown>(index.transcriptRef)]);
            const materials = { untrustedCandidateData: true, rawLocatorIdentityPreserved: true, documents: decisionSafeJson(documents), transcript: decisionSafeJson(transcript) };
            const stored = await storeJson("matrix-decision-safe-context", operationIdentity, { schemaVersion: "matrix-decision-safe-context/v1", indexRef, materials });
            return { artifactRef: stored.artifactRef, checksum: stored.checksum };
          }
          if (toolKey === "candidate.matrix-claims/v1" || toolKey === "candidate.matrix-claim-submit/v1") {
            const contextRef = await latestArtifact("candidate.matrix-context-read/v1");
            const context = await artifactStore.getJson<{ materials?: Record<string, unknown> }>(contextRef);
            if (!context.materials) throw new Error("MATRIX_DECISION_SAFE_CONTEXT_INVALID");
            const materials = context.materials;
            const claimConfig = llmDependencies.configuration.resolve("criterion_claim_extraction");
            const signalConfig = llmDependencies.configuration.resolve("unmapped_signal_discovery");
            const maxContextTokens = Number(input.environment.ROUTERAI_CONTEXT_WINDOW_TOKENS ?? 128_000);
            const safetyTokens = Number(input.environment.MATRIX_BATCH_SAFETY_TOKENS ?? 4_096);
            const claimBatches = buildCriterionClaimExtractionBatches({
              matrix,
              materials,
              scope: { candidateId: candidatePk, runId, inputVersion, profileVersion },
              maxContextTokens,
              countContextTokens: (request) => Math.max(
                countOpenAiCompatibleContextTokens({ config: claimConfig, userContent: request as JsonValue, safetyTokens }),
                countOpenAiCompatibleContextTokens({ config: signalConfig, userContent: request as JsonValue, safetyTokens }),
              ),
              overlapUtterances: 2,
            });
            const directedResults: Awaited<ReturnType<typeof call>>[] = [];
            const openResults: Awaited<ReturnType<typeof call>>[] = [];
            const coverageWarnings: string[] = [];
            const coverageEntries: BatchCoverageEntry[] = [];
            const coverageLedger: Array<{ batchId: string; requestedCriterionIds: string[]; coverage: BatchCoverageEntry[] }> = [];
            const allCriterionIds = matrixCriterionIds(matrix.criteria);
            const reportFieldRequests = [
              { field: "workFormat", sourceClass: "report.organization.work-format", instruction: "Предпочтительный формат работы: удалённо, офис или гибрид." },
              { field: "city", sourceClass: "report.organization.city", instruction: "Город проживания кандидата." },
              { field: "income", sourceClass: "report.organization.income", instruction: "Ожидаемый доход кандидата с валютой и net/gross, если указано." },
              { field: "trialDay", sourceClass: "report.organization.trial-day", instruction: "Готовность и срок выхода на тестовый день." },
              { field: "start", sourceClass: "report.organization.start", instruction: "Готовность и срок постоянного выхода на работу; не подменять тестовым днём." },
              { field: "technical", sourceClass: "report.technical", instruction: "Конкретные программы, сервисы, ИИ-инструменты и технические способы работы." },
              { field: "motivation", sourceClass: "report.motivation", instruction: "Почему кандидату интересна роль, что мотивирует и какие условия он ценит." },
            ];
            for (const claimBatch of claimBatches) {
              let directed: Awaited<ReturnType<typeof call>> | undefined;
              const reportAwareRequest = { ...claimBatch.request, reportFieldRequests };
              try { directed = await call("criterion_claim_extraction", reportAwareRequest, `directed-${claimBatch.batchId}`); }
              catch { coverageWarnings.push(`PRIMARY_EXTRACTION_FAILED:${claimBatch.batchId}`); }
              const primaryCoverage = Array.isArray(directed?.output.coverage) ? directed.output.coverage as unknown as BatchCoverageEntry[] : [];
              const primaryValidation = validateExactCriterionCoverage(allCriterionIds, primaryCoverage);
              let targeted: Awaited<ReturnType<typeof call>> | undefined;
              const retryIds = directed ? primaryValidation.missingIds : allCriterionIds;
              if (retryIds.length || primaryValidation.duplicateIds.length || primaryValidation.unknownIds.length) {
                try {
                  targeted = await call("criterion_claim_extraction", { ...reportAwareRequest, requestedCriterionIds: retryIds.length ? retryIds : allCriterionIds,
                    coverageRetry: { targeted: true, reason: "MISSING_OR_INVALID_CRITERION_IDS" } }, `coverage-retry-${claimBatch.batchId}`);
                } catch { coverageWarnings.push(`TARGETED_EXTRACTION_FAILED:${claimBatch.batchId}`); }
              }
              if (directed) directedResults.push(directed);
              if (targeted) directedResults.push(targeted);
              const combinedCoverage = [...primaryCoverage, ...(Array.isArray(targeted?.output.coverage) ? targeted.output.coverage as unknown as BatchCoverageEntry[] : [])]
                .filter((entry, index, values) => allCriterionIds.includes(entry.criterionId) && values.findIndex((item) => item.criterionId === entry.criterionId) === index);
              const remaining = validateExactCriterionCoverage(allCriterionIds, combinedCoverage).missingIds;
              const completedBatchCoverage = [...combinedCoverage, ...remaining.map((criterionId) => ({ criterionId, scanResult: "NOT_FOUND_IN_BATCH" as const, evidence: [] }))];
              coverageEntries.push(...completedBatchCoverage);
              coverageLedger.push({ batchId: claimBatch.batchId, requestedCriterionIds: [...allCriterionIds], coverage: completedBatchCoverage });
              if (remaining.length) coverageWarnings.push(`TECHNICAL_COVERAGE_FALLBACK:${claimBatch.batchId}:${remaining.length}`);
              try { openResults.push(await call("unmapped_signal_discovery", { ...claimBatch.request, policy: { informationalOnly: true, balancedTypes: ["STRENGTH", "CONCERN", "QUESTION"], mayCreateCriteria: false } }, `open-${claimBatch.batchId}`)); }
              catch { coverageWarnings.push(`BALANCED_OPEN_PASS_FAILED:${claimBatch.batchId}`); }
            }
            const initiallyEmptyIds = allCriterionIds.filter((criterionId) => !coverageEntries.some((entry) => entry.criterionId === criterionId && entry.scanResult === "FOUND"));
            if (initiallyEmptyIds.length) {
              for (const claimBatch of claimBatches) {
                try {
                  const gap = await call("criterion_claim_extraction", { ...claimBatch.request, requestedCriterionIds: initiallyEmptyIds,
                    gapSearch: { boundedPass: 1, evaluateCandidate: false } }, `gap-search-${claimBatch.batchId}`);
                  directedResults.push(gap);
                  if (Array.isArray(gap.output.coverage)) coverageEntries.push(...gap.output.coverage as unknown as BatchCoverageEntry[]);
                } catch { coverageWarnings.push(`GAP_SEARCH_FAILED:${claimBatch.batchId}`); }
              }
            }
            const rawClaims = directedResults.flatMap((result) => result.output.claims as Array<Record<string, unknown>>);
            const claimsWithDuplicates: Array<CandidateSourceClaim & { decisionAdmissible: boolean }> = rawClaims.map((source, index) => {
              const role = String(source.role ?? "unknown") as CandidateSourceClaim["role"];
              if (!['candidate','interviewer','recruiter','unknown'].includes(role)) throw new Error("MATRIX_CLAIM_ROLE_INVALID");
              const criterionIds = Array.isArray(source.criterionIds) ? source.criterionIds.filter((item): item is string => typeof item === "string") : [];
              const provenance = directedResults.find((result) => (result.output.claims as Array<Record<string, unknown>>).includes(source));
              const claim: CandidateSourceClaim = { claimId: `claim-${matrixChecksum([runId, source.locator, source.text, [...criterionIds].sort(), source.sourceClass, source.relation]).slice(0, 24)}`, candidateId: String(candidatePk), runId, inputVersion, profileVersion,
                author: text(source.author, "MATRIX_CLAIM_AUTHOR_INVALID"), role, roleConfidence: typeof source.roleConfidence === "number" ? source.roleConfidence : undefined,
                text: text(source.text, "MATRIX_CLAIM_TEXT_INVALID"), locator: text(source.locator, "MATRIX_CLAIM_LOCATOR_INVALID"), provenanceRef: provenance?.traceRef ?? directedResults[Math.min(index, directedResults.length - 1)]?.traceRef ?? "",
                criterionIds, sourceClass: text(source.sourceClass, "MATRIX_CLAIM_SOURCE_CLASS_INVALID"), directness: source.directness === "indirect" ? "indirect" : "direct",
                relation: ["SUPPORTS", "CONTRADICTS", "CONTEXT"].includes(String(source.relation)) ? source.relation as CandidateSourceClaim["relation"] : "CONTEXT" };
              return { ...claim, decisionAdmissible: candidateClaimIsDecisionAdmissible(claim) };
            });
            const claims = [...new Map(claimsWithDuplicates.map((claim) => [claim.claimId, claim])).values()];
            for (const claim of claims) await matrixRepository.appendClaim({ candidateId: candidatePk, claim });
            const unmappedSignals = [...new Map(openResults.flatMap((result) => result.output.signals as Array<Record<string, unknown>>)
              .map((signal) => [String(signal.signalId ?? matrixChecksum([signal.locator, signal.text, signal])), signal])).values()];
            const mergedCoverage = deduplicateCoverageEvidence(coverageEntries);
            const stored = await storeJson("matrix-claims", operationIdentity, { schemaVersion: "matrix-claims-bundle/v2", claims, unmappedSignals, coverage: mergedCoverage, coverageLedger,
              coverageSummary: { criterionCount: allCriterionIds.length, coveredCount: mergedCoverage.filter((entry) => entry.scanResult === "FOUND").length,
                technicalFallbackCount: coverageWarnings.filter((warning) => warning.startsWith("TECHNICAL_COVERAGE_FALLBACK")).length, gapSearchExecuted: initiallyEmptyIds.length > 0 },
              warnings: coverageWarnings, batches: claimBatches.map(({ batchId, order }) => ({ batchId, order })), traceRefs: [...directedResults, ...openResults].map((result) => result.traceRef) });
            return { artifactRef: stored.artifactRef, checksum: stored.checksum };
          }
          if (toolKey === "candidate.matrix-evidence/v1" || toolKey === "candidate.matrix-conflict-submit/v1") {
            const claimsRef = await latestArtifact("candidate.matrix-claim-submit/v1");
            const claims = await artifactStore.getJson<Record<string, unknown>>(claimsRef);
            const warnings: string[] = [];
            let consolidated: Awaited<ReturnType<typeof call>> | undefined;
            let conflicts: Awaited<ReturnType<typeof call>> | undefined;
            try { consolidated = await call("evidence_consolidation", { matrix, claims, policy: { verdictForbidden: true, selfReportAdmissible: true } }, "consolidate"); }
            catch { warnings.push("EVIDENCE_CONSOLIDATION_FAILED"); }
            try { conflicts = await call("global_conflict_detection", { matrix, claims, consolidated: consolidated?.output ?? { claimGroups: [] },
              policy: { omissionIsNotConflict: true, differentPeriodsAreNotConflict: true, correctionIsNotConflict: true } }, "global-conflicts"); }
            catch { warnings.push("GLOBAL_CONFLICT_DETECTION_FAILED"); }
            for (const conflict of (conflicts?.output.conflicts as Array<Record<string, unknown>> | undefined ?? [])) {
              const claimIds = Array.isArray(conflict.claimIds) ? conflict.claimIds.filter((item): item is string => typeof item === "string") : [];
              if (claimIds.length < 2) throw new Error("MATRIX_CONFLICT_SIDES_MISSING");
              await matrixRepository.appendConflict({ candidateId: candidatePk, runId, inputVersion, profileVersion, predicate: text(conflict.predicate, "MATRIX_CONFLICT_PREDICATE_INVALID"), claimIds,
                followUpQuestion: text(conflict.followUpQuestion, "MATRIX_CONFLICT_QUESTION_INVALID"), provenanceRef: conflicts!.traceRef });
            }
            const stored = await storeJson("matrix-evidence", operationIdentity, { schemaVersion: "matrix-evidence/v2", claimsRef,
              claimGroups: consolidated?.output.claimGroups ?? [], conflicts: conflicts?.output.conflicts ?? [], warnings,
              traceRefs: [consolidated?.traceRef, conflicts?.traceRef].filter((value): value is string => Boolean(value)) });
            return { artifactRef: stored.artifactRef, checksum: stored.checksum };
          }
          if (toolKey === "candidate.matrix-rows/v1") {
            const evidenceRef = await latestArtifact("candidate.matrix-conflict-submit/v1");
            const evidence = await artifactStore.getJson<Record<string, unknown>>(evidenceRef);
            const claimBundle = typeof evidence.claimsRef === "string"
              ? await artifactStore.getJson<{ claims?: CandidateSourceClaim[]; coverageSummary?: unknown; warnings?: string[] }>(evidence.claimsRef)
              : {};
            const claims = Array.isArray(claimBundle.claims) ? claimBundle.claims : [];
            const claimCoverage = claimBundle;
            const ids = matrixCriterionIds(matrix.criteria);
            const warnings: string[] = [];
            const traceRefs: string[] = [];
            let initial: Awaited<ReturnType<typeof call>> | undefined;
            try { initial = await call("matrix_row_evaluation", { matrix, evidence: { ...evidence, claims }, requestedCriterionIds: ids,
              policy: { allowedStates: ["Соответствует", "Не соответствует", "Недостаточно данных"], selfReportAdmissible: true, holisticRecommendation: true } }, "rows"); traceRefs.push(initial.traceRef); }
            catch { warnings.push("ROW_EVALUATION_FAILED"); }
            const accepted = new Map<string, CandidateMatrixRow>();
            for (const row of (initial?.output.rows as unknown as CandidateMatrixRow[] | undefined ?? [])) if (ids.includes(row.criterionId) && !accepted.has(row.criterionId)
              && validateCandidateMatrixRows([row.criterionId], [row], claims).decision === "PASS") accepted.set(row.criterionId, row);
            let missingIds = ids.filter((id) => !accepted.has(id));
            if (missingIds.length) {
              try {
                const targeted = await call("matrix_row_evaluation", { matrix, evidence: { ...evidence, claims }, requestedCriterionIds: missingIds,
                  policy: { targetedRetry: true, allowedStates: ["Соответствует", "Не соответствует", "Недостаточно данных"], selfReportAdmissible: true, holisticRecommendation: true } }, "rows-targeted-retry");
                traceRefs.push(targeted.traceRef);
                for (const row of targeted.output.rows as unknown as CandidateMatrixRow[]) if (missingIds.includes(row.criterionId) && !accepted.has(row.criterionId)
                  && validateCandidateMatrixRows([row.criterionId], [row], claims).decision === "PASS") accepted.set(row.criterionId, row);
              } catch { warnings.push("ROW_TARGETED_RETRY_FAILED"); }
            }
            missingIds = ids.filter((id) => !accepted.has(id));
            for (const id of missingIds) accepted.set(id, technicalFallbackRow(id));
            if (missingIds.length) warnings.push(`TECHNICAL_ROW_FALLBACK:${missingIds.length}`);
            const candidateRows = ids.map((id) => accepted.get(id)!);
            let abcDirections: unknown[] = [];
            const vacancy = await vacancyContext();
            const availableAbcDirections = Array.isArray(vacancy.vacancy?.abcDirections) ? vacancy.vacancy.abcDirections.filter((direction) =>
              direction && typeof direction === "object" && !Array.isArray(direction)
              && typeof direction.id === "string" && direction.id.trim()
              && [direction.name, direction.title].some((name) => typeof name === "string" && name.trim())) : [];
            if (availableAbcDirections.length) try {
              const abc = await call("abc_matrix_assessment", { directions: availableAbcDirections, evidence: { ...evidence, claims }, policy: {
                bestFit: true, fullCoverageRequired: true, selfReportAdmissible: true, inferMissingLevelDefinitions: true,
                fallbackScale: { A: "выше ожиданий роли", B: "соответствует ожиданиям роли", C: "ниже ожиданий или требует заметной поддержки" },
                insufficientOnlyWhenNoRelevantCandidateEvidence: true,
              } }, "abc");
              traceRefs.push(abc.traceRef); abcDirections = abc.output.directions as unknown[];
            } catch { warnings.push("ABC_ASSESSMENT_SKIPPED"); }
            else warnings.push("ABC_PROFILE_NOT_CONFIGURED");
            const stored = await storeJson("matrix-rows", operationIdentity, { schemaVersion: "candidate-matrix-rows-bundle/v3", matrixId: published.matrixId, evidenceRef, rows: candidateRows, abcDirections,
              recommendation: String(initial?.output.recommendation ?? (missingIds.length === ids.length ? "Недостаточно данных" : "Рекомендовать с оговорками")),
              recommendationReason: String(initial?.output.recommendationReason ?? "Рекомендация сформирована по доступным строкам; часть оценки потребовала технического fallback."),
              coverageSummary: { extraction: claimCoverage.coverageSummary, evaluation: { criterionCount: ids.length, evaluatedCount: ids.length, technicalFallbackCount: missingIds.length } },
              warnings: [...(claimCoverage.warnings ?? []), ...(Array.isArray(evidence.warnings) ? evidence.warnings.filter((item): item is string => typeof item === "string") : []), ...warnings], traceRefs });
            return { artifactRef: stored.artifactRef, checksum: stored.checksum };
          }
          if (toolKey === "candidate.matrix-verify/v1") {
            const rowsRef = await latestArtifact("candidate.matrix-rows/v1");
            const rows = await artifactStore.getJson<Record<string, unknown>>(rowsRef);
            const bundleRows = Array.isArray(rows.rows) ? rows.rows as CandidateMatrixRow[] : [];
            const criterion = new Map<string, MatrixCriterion>();
            const visit = (criteria: readonly MatrixCriterion[]) => criteria.forEach((item) => { criterion.set(item.criterionId, item); visit(item.children); });
            visit(matrix.criteria);
            const verificationTargets = bundleRows.filter((row) => {
              const item = criterion.get(row.criterionId);
              const triggeredStop = item?.hardRequired && ["Соответствует", "Подтверждено"].includes(row.state);
              const materialRejection = !item?.hardRequired && String(rows.recommendation) === "Не рекомендовать" && ["Не соответствует", "Не подтверждено"].includes(row.state);
              return triggeredStop || materialRejection;
            });
            const evidenceRef = typeof rows.evidenceRef === "string" ? rows.evidenceRef : undefined;
            let claims: unknown[] = [];
            if (evidenceRef) {
              const evidence = await artifactStore.getJson<{ claimsRef?: string }>(evidenceRef);
              if (evidence.claimsRef) claims = (await artifactStore.getJson<{ claims?: unknown[] }>(evidence.claimsRef)).claims ?? [];
            }
            let verificationResults: CriticalVerificationDecision[] = [];
            let verificationTraceRef = "NOT_REQUIRED";
            const warnings: string[] = [];
            if (verificationTargets.length) {
              try {
                const verified = await call("critical_row_verification", { matrix, rows: verificationTargets, claims,
                  policy: { verifyOnly: ["triggered-stop-factor", "material-rejection"], exactQuotesProvided: true, selfReportAdmissible: true, failSoft: true } }, "verify");
                verificationResults = verified.output.results as CriticalVerificationDecision[]; verificationTraceRef = verified.traceRef;
              } catch { warnings.push("CRITICAL_ROW_VERIFICATION_FAILED_PRESERVED_ORIGINAL"); }
            }
            const adjustedRows = applyCriticalVerificationDecisions(bundleRows, verificationResults);
            for (const row of adjustedRows) await matrixRepository.appendRow({ candidateId: candidatePk, runId, inputVersion, profileVersion, matrixId: published.matrixId,
              row, verificationTraceRef });
            const stored = await storeJson("matrix-verification", operationIdentity, { schemaVersion: "matrix-verification/v2", rowsRef, results: verificationResults, adjustedRows,
              criticalRisks: [], warnings, traceRefs: verificationTraceRef === "NOT_REQUIRED" ? [] : [verificationTraceRef], traceRef: verificationTraceRef });
            return { artifactRef: stored.artifactRef, checksum: stored.checksum };
          }
          if (toolKey === "candidate.matrix-recommendation/v1") {
            const rowsRef = await latestArtifact("candidate.matrix-rows/v1");
            const verificationRef = await latestArtifact("candidate.matrix-verify/v1");
            const verification = await artifactStore.getJson<{ results?: CriticalVerificationDecision[]; adjustedRows?: CandidateMatrixRow[] }>(verificationRef);
            const bundle = await artifactStore.getJson<{ rows?: CandidateMatrixRow[]; recommendation?: string; recommendationReason?: string; abcDirections?: Array<Record<string, unknown>>; evidenceRef?: string; coverageSummary?: unknown; warnings?: string[] }>(rowsRef);
            const effectiveRows = Array.isArray(verification.adjustedRows)
              ? verification.adjustedRows
              : applyCriticalVerificationDecisions(bundle.rows ?? [], verification.results ?? []);
            const criterion = new Map<string, MatrixCriterion>();
            const visit = (criteria: readonly MatrixCriterion[]) => criteria.forEach((item) => { criterion.set(item.criterionId, item); visit(item.children); });
            visit(matrix.criteria);
            const values = effectiveRows;
            const evidenceRef = await latestArtifact("candidate.matrix-conflict-submit/v1");
            const matrixEvidence = await artifactStore.getJson<{ conflicts?: unknown[]; claimsRef?: string }>(evidenceRef);
            const claimBundle = matrixEvidence.claimsRef ? await artifactStore.getJson<{ unmappedSignals?: Array<Record<string, unknown>> }>(matrixEvidence.claimsRef) : {};
            const signals = claimBundle.unmappedSignals ?? [];
            const displayState = (state: string) => state === "Соответствует" ? "Подтверждено" : state === "Не соответствует" ? "Не подтверждено" : state;
            const itemFor = (row: CandidateMatrixRow) => ({ name: criterion.get(row.criterionId)?.sourceText ?? row.criterionId, state: displayState(row.state), reason: row.reason,
              factIds: [...row.supportingClaimIds, ...row.contradictingClaimIds] });
            const positiveRows = values.filter((row) => ["Соответствует", "Подтверждено"].includes(row.state));
            const negativeRows = values.filter((row) => ["Не соответствует", "Не подтверждено"].includes(row.state));
            const observationReason = (signal: Record<string, unknown>) => {
              const source = /transcript|interview|стенограмм|интервью/iu.test(String(signal.sourceClass ?? "")) ? "Интервью"
                : /resume|резюме/iu.test(String(signal.sourceClass ?? "")) ? "Резюме"
                  : /recommend|рекомендац/iu.test(String(signal.sourceClass ?? "")) ? "Рекомендация" : "Документ кандидата";
              return `${source}: ${String(signal.text)}`;
            };
            const additionalStrengths = signals.filter((signal) => signal.observationType === "STRENGTH").map((signal) => ({ name: String(signal.text), state: "Подтверждено", reason: observationReason(signal), factIds: [String(signal.signalId)] }));
            const additionalConcerns = signals.filter((signal) => signal.observationType === "CONCERN").map((signal) => ({ name: String(signal.text), state: "Частично подтверждено", reason: observationReason(signal), factIds: [String(signal.signalId)] }));
            const triggeredStops = positiveRows.filter((row) => criterion.get(row.criterionId)?.hardRequired);
            const allowedRecommendations = new Set(["Рекомендовать", "Рекомендовать с оговорками", "Не рекомендовать", "Недостаточно данных"]);
            const holisticRecommendation = allowedRecommendations.has(String(bundle.recommendation)) ? String(bundle.recommendation) : "Недостаточно данных";
            const recommendation = triggeredStops.length ? "Не рекомендовать" : holisticRecommendation;
            const selectedBranch = triggeredStops.length ? "STOP_FACTOR" : "HOLISTIC_LLM";
            const abcDirections = bundle.abcDirections ?? [];
            const abcStates = Object.fromEntries(abcDirections.filter((direction) => typeof direction.directionId === "string").map((direction) => [String(direction.directionId), direction.level]));
            const abcEvidence = Object.fromEntries(abcDirections.filter((direction) => typeof direction.directionId === "string").map((direction) => [String(direction.directionId), {
              reason: direction.reason, factIds: direction.evidenceLocatorIds ?? [], definingConditions: direction.definingConditions ?? [],
            }]));
            const structuredAssessment = { matrixRows: values, matrixCriteria: Object.fromEntries([...criterion].map(([id, item]) => [id, { category: item.category, sourceText: item.sourceText, interpretation: item.interpretation, interpretationNotes: item.interpretationNotes, sourceRefs: item.sourceRefs, required: item.required, requiredExplanation: item.requiredExplanation, hardRequired: item.hardRequired }])), matrixConflicts: matrixEvidence.conflicts ?? [], criticalUnmappedRisks: [],
              observations: values.map((row) => ({ criterion: row.criterionId, category: criterion.get(row.criterionId)?.category ?? "additional", required: criterion.get(row.criterionId)?.required ?? false, state: displayState(row.state), reason: row.conclusion ?? row.reason, factIds: [...row.supportingClaimIds, ...row.contradictingClaimIds] })), abcConfigured: abcDirections.length > 0, abcStates, abcEvidence,
              competencies: [...positiveRows.filter((row) => criterion.get(row.criterionId)?.category === "competency").map(itemFor), ...additionalStrengths],
              accessToKe: values.filter((row) => criterion.get(row.criterionId)?.category === "access-to-ke").map((row) => ({ ...itemFor(row), required: criterion.get(row.criterionId)?.required ?? false })),
              risks: [...negativeRows.filter((row) => !criterion.get(row.criterionId)?.hardRequired).map(itemFor), ...additionalConcerns], stopFactors: triggeredStops.map(itemFor) };
            const stored = await storeJson("matrix-assessment-snapshot", operationIdentity, { schemaVersion: "matrix-assessment-snapshot/v2", workflowVersion: MATRIX_WORKFLOW_VERSION, inputVersion, profileVersion, matrixId: published.matrixId, matrixChecksum: matrix.checksum,
              skillVersions: { ...matrix.skillVersions, extraction: "extract-claims-for-criteria/v1", recommendation: "fill-matrix-rows/v2" }, modelVersions: matrix.modelVersions,
              schemaVersions: { matrix: matrix.schemaVersion, rows: "candidate-matrix-rows/v2", verification: "candidate-row-verification/v1" }, policyVersions: { compiler: matrix.compilerPolicyVersion, recommendation: "ASM-050/coverage-first-evidence-v2" },
              rowsRef, evidenceRef, verificationRef, structuredAssessment, criticalUnmappedRisks: [], coverageSummary: bundle.coverageSummary, warnings: bundle.warnings ?? [],
              recommendation, recommendationReason: triggeredStops.length ? "Подтверждён явный стоп-фактор вакансии." : bundle.recommendationReason, selectedBranch, formulaInputs: { rows: values } });
            return { artifactRef: stored.artifactRef, checksum: stored.checksum };
          }
          throw new Error("MATRIX_TOOL_NOT_REGISTERED");
        },
      },
      assemblyAI: {
        create: async () => {
          if (!artifactStore) throw new Error("PRODUCTION_TRANSCRIPTION_ARTIFACT_STORE_NOT_PROVISIONED");
          const restored = await queryOne<{ remote_job_id: string }>(input.database, `SELECT cp.remote_job_id FROM agent_checkpoints cp JOIN agent_attempts a ON a.id=cp.attempt_id
            WHERE a.task_id=$1 AND (cp.kind='provider-job-created' OR (cp.kind='transcript-persisted' AND cp.remote_job_id LIKE 'ready-transcript:%')) AND cp.remote_job_id IS NOT NULL
            ORDER BY CASE WHEN cp.kind='transcript-persisted' THEN 0 ELSE 1 END, cp.created_at DESC LIMIT 1`, [taskId]);
          if (restored?.remote_job_id) return { remoteJobId: restored.remote_job_id };
          const manifest = await materialManifest();
          const interviews = (manifest.entries ?? []).filter((entry) => entry.role === "interview" && entry.supported !== false);
          if (interviews.length !== 1) throw new Error("INTERVIEW_MATERIAL_NOT_UNAMBIGUOUS");
          const interview = interviews[0];
          await authorizeFile("download", interview.fileId);
          const expectedChecksum = await immutableFileChecksum(interview.fileId);
          const source = await drive.downloadVersion({ fileId: interview.fileId, expectedVersion: interview.version,
            expectedSize: interview.size, expectedModifiedTime: interview.modifiedTime, expectedChecksum,
            checkpoint: (value) => checkpoint({ kind: "drive-download", identity: `${operationIdentity}:source`, artifactIdentity: `${value.fileId}:${value.version}`, checksum: value.checksum }) });
          if (interview.interviewSource === "ready-transcript") {
            let extractedText: string | undefined;
            if (interview.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
              if (!input.environment.DOCUMENT_PROCESSOR_URL || !input.environment.DOCUMENT_PROCESSOR_TOKEN) throw new Error("PRODUCTION_DOCUMENT_PROCESSOR_NOT_PROVISIONED");
              const processorUrl = new URL(input.environment.DOCUMENT_PROCESSOR_URL);
              if (input.environment.E2E_ENVIRONMENT === "local") {
                if (!loopbackOrDockerHostname(processorUrl.hostname) || !["http:", "https:"].includes(processorUrl.protocol)) throw new Error("LOCAL_DOCUMENT_PROCESSOR_MUST_BE_LOOPBACK");
              } else if (processorUrl.protocol !== "https:" && !dockerInternalProcessorEndpoint(processorUrl, "document-processor")) throw new Error("REMOTE_DOCUMENT_PROCESSOR_MUST_USE_HTTPS");
              await auditBoundary("provider", source.bytes);
              const extractionResponse = await fetch(processorUrl, { method: "POST",
                headers: { authorization: `Bearer ${input.environment.DOCUMENT_PROCESSOR_TOKEN}`, "content-type": interview.mimeType },
                body: source.bytes.slice().buffer as ArrayBuffer, signal: AbortSignal.timeout(5 * 60_000) });
              const extracted = await extractionResponse.json() as { code?: string; kind?: string; sections?: ExtractedSection[] };
              if (!extractionResponse.ok) throw new Error(extracted.code ?? `DOCUMENT_PROCESSOR_HTTP_${extractionResponse.status}`);
              if (extracted.kind !== "docx" || !Array.isArray(extracted.sections)) throw new Error("DOCUMENT_PROCESSOR_DOCX_OUTPUT_INVALID");
              extractedText = extracted.sections.map((section) => section.text.trim()).filter(Boolean).join("\n");
            }
            const parsed = parseReadyTranscript({ fileId: interview.fileId, fileVersion: interview.version, fileName: interview.name,
              mimeType: interview.mimeType, ...(extractedText === undefined ? { bytes: source.bytes } : { extractedText }) });
            const remoteJobId = `ready-transcript:${sha256([operationIdentity, source.checksum]).slice(0, 24)}`;
            const representations = transcriptRepresentations({ providerJobId: remoteJobId,
              raw: { schemaVersion: parsed.schemaVersion, source: parsed.source, text: parsed.text, timingSource: "provided-text" },
              words: parsed.words, utterances: parsed.utterances });
            await auditBoundary("blob", new TextEncoder().encode(JSON.stringify(representations)));
            const stored = await artifactStore.putJson({ candidatePk, runId: text(task.runId, "PRODUCTION_TASK_RUN_ID_MISSING"), kind: "transcript-bundle",
              identity: operationIdentity, value: representations });
            await checkpoint({ kind: "transcript-persisted", identity: operationIdentity, remoteJobId, artifactIdentity: stored.artifactRef, checksum: stored.checksum });
            return { remoteJobId };
          }
          if (!input.environment.ASSEMBLYAI_API_KEY || !input.environment.MEDIA_PROCESSOR_URL || !input.environment.MEDIA_PROCESSOR_TOKEN) {
            throw new Error("PRODUCTION_ASSEMBLYAI_STAGE_CONTEXT_NOT_PROVISIONED");
          }
          const mediaUrl = new URL(input.environment.MEDIA_PROCESSOR_URL);
          if (input.environment.E2E_ENVIRONMENT === "local") {
            if (!loopbackOrDockerHostname(mediaUrl.hostname) || !["http:", "https:"].includes(mediaUrl.protocol)) throw new Error("LOCAL_MEDIA_PROCESSOR_MUST_BE_LOOPBACK");
          } else if (mediaUrl.protocol !== "https:" && !dockerInternalProcessorEndpoint(mediaUrl, "media-processor")) throw new Error("REMOTE_MEDIA_PROCESSOR_MUST_USE_HTTPS");
          await auditBoundary("provider", source.bytes);
          const mediaResponse = await fetch(mediaUrl, { method: "POST", headers: { authorization: `Bearer ${input.environment.MEDIA_PROCESSOR_TOKEN}`, "content-type": interview.mimeType },
            body: source.bytes.slice().buffer as ArrayBuffer, signal: AbortSignal.timeout(15 * 60_000) });
          if (!mediaResponse.ok) throw new Error(`MEDIA_PROCESSOR_HTTP_${mediaResponse.status}`);
          const audioBytes = new Uint8Array(await mediaResponse.arrayBuffer());
          const audioChecksum = mediaResponse.headers.get("x-audio-sha256") ?? sha256(audioBytes);
          await checkpoint({ kind: "audio-extracted", identity: `${operationIdentity}:audio`, artifactIdentity: `audio:${audioChecksum}`, checksum: audioChecksum });
          await auditBoundary("provider", audioBytes);
          const provider = new DurableAssemblyAiAdapter({ apiKey: input.environment.ASSEMBLYAI_API_KEY });
          return provider.create({ audioBytes, operationIdentity, checkpoint: async ({ remoteJobId }) => {
            await checkpoint({ kind: "provider-job-created", identity: operationIdentity, remoteJobId });
          } });
        },
        poll: async (remoteJobId) => {
          if (!artifactStore) throw new Error("PRODUCTION_TRANSCRIPTION_ARTIFACT_STORE_NOT_PROVISIONED");
          if (remoteJobId.startsWith("ready-transcript:")) {
            const persisted = await queryOne<{ artifact_identity: string }>(input.database, `SELECT cp.artifact_identity FROM agent_checkpoints cp JOIN agent_attempts a ON a.id=cp.attempt_id
              WHERE a.task_id=$1 AND cp.kind='transcript-persisted' AND cp.remote_job_id=$2 AND cp.artifact_identity IS NOT NULL ORDER BY cp.created_at DESC LIMIT 1`, [taskId, remoteJobId]);
            if (!persisted?.artifact_identity) throw new Error("READY_TRANSCRIPT_ARTIFACT_CHECKPOINT_MISSING");
            return { status: "completed", artifactRef: persisted.artifact_identity };
          }
          if (!input.environment.ASSEMBLYAI_API_KEY) throw new Error("PRODUCTION_ASSEMBLYAI_STAGE_CONTEXT_NOT_PROVISIONED");
          const provider = new DurableAssemblyAiAdapter({ apiKey: input.environment.ASSEMBLYAI_API_KEY });
          let raw: Record<string, unknown> | undefined;
          for (let attempt = 0; attempt < 300; attempt += 1) {
            raw = await provider.poll(remoteJobId);
            if (raw.status === "completed" || raw.status === "error") break;
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 3_000));
          }
          if (raw?.status !== "completed") throw new Error(raw?.status === "error" ? "ASSEMBLYAI_TRANSCRIPTION_FAILED" : "ASSEMBLYAI_TRANSCRIPTION_TIMEOUT");
          const words = (Array.isArray(raw.words) ? raw.words : []) as TranscriptWord[];
          const utterances = (Array.isArray(raw.utterances) ? raw.utterances : []) as TranscriptUtterance[];
          const representations = transcriptRepresentations({ providerJobId: remoteJobId, raw, words, utterances });
          await auditBoundary("blob", new TextEncoder().encode(JSON.stringify(representations)));
          const stored = await artifactStore.putJson({ candidatePk, runId: text(task.runId, "PRODUCTION_TASK_RUN_ID_MISSING"), kind: "transcript-bundle",
            identity: operationIdentity, value: representations });
          await checkpoint({ kind: "transcript-persisted", identity: operationIdentity, remoteJobId, artifactIdentity: stored.artifactRef, checksum: stored.checksum });
          await provider.remove(remoteJobId);
          return { status: "completed", artifactRef: stored.artifactRef };
        },
      },
      validation: {
        validate: async () => {
          if (!artifactStore) throw new Error("PRODUCTION_ARTIFACT_STORE_NOT_PROVISIONED");
          const assessmentRef = await latestArtifact("candidate.matrix-recommendation/v1");
            const assessment = await artifactStore.getJson<{ schemaVersion?: string; inputVersion?: string; profileVersion?: string; matrixId?: string; matrixChecksum?: string; rowsRef?: string; evidenceRef?: string; verificationRef?: string; recommendation?: ReportModel["recommendation"]; selectedBranch?: string; criticalUnmappedRisks?: CriticalUnmappedRisk[]; coverageSummary?: unknown; warnings?: string[] }>(assessmentRef);
            if (!new Set(["matrix-assessment-snapshot/v1", "matrix-assessment-snapshot/v2"]).has(String(assessment.schemaVersion)) || assessment.inputVersion !== inputVersion || assessment.profileVersion !== profileVersion
              || !assessment.matrixId || !assessment.matrixChecksum || !assessment.rowsRef || !assessment.evidenceRef || !assessment.verificationRef || !assessment.recommendation) throw new Error("MATRIX_ASSESSMENT_SNAPSHOT_SCOPE_INVALID");
            const matrix = await new PostgresVacancyMatrixRepository(input.database, goal.workflow_version).readMatrix(profileVersion);
            if (!matrix || matrix.matrixId !== assessment.matrixId || matrix.checksum !== assessment.matrixChecksum) throw new Error("MATRIX_ASSESSMENT_MATRIX_MISMATCH");
            const rows = await artifactStore.getJson<{ rows?: CandidateMatrixRow[] }>(assessment.rowsRef);
            const ids: string[] = [];
            const visit = (criteria: readonly MatrixCriterion[]) => criteria.forEach((criterion) => { ids.push(criterion.criterionId); visit(criterion.children); });
            visit(matrix.matrix.criteria);
            if (validateCandidateMatrixRows(ids, rows.rows ?? []).decision !== "PASS") throw new Error("MATRIX_ROW_COVERAGE_INVALID");
            const verification = await artifactStore.getJson<{ results?: Array<{ criterionId?: string; decision?: string }> }>(assessment.verificationRef);
            if (!Array.isArray(verification.results)) throw new Error("MATRIX_VERIFICATION_MISSING");
            if ((assessment.criticalUnmappedRisks ?? []).some((risk) => risk.verificationDecision === "VERIFIED_CRITICAL"
              && (!risk.evidenceLocators.length || !risk.assessmentTraceRef || !risk.verificationTraceRef || risk.assessmentTraceRef === risk.verificationTraceRef))) throw new Error("MATRIX_CRITICAL_RISK_PROVENANCE_INVALID");
            const stored = await storeJson("validated-assessment", operationIdentity, { schemaVersion: "validated-matrix-assessment/v2", assessmentRef, recommendation: assessment.recommendation, matrixId: assessment.matrixId, matrixChecksum: assessment.matrixChecksum, workflowVersion: MATRIX_WORKFLOW_VERSION,
              coverageSummary: assessment.coverageSummary, warnings: assessment.warnings ?? [], gates: { schema: true, coverage: true, auxiliaryVerification: true, holisticRecommendation: true } });
            const assessmentId = `assessment-${sha256([runId, assessmentRef]).slice(0, 24)}`;
            await execute(input.database, `INSERT INTO candidate_assessments (id,artifact_id,attempt,recommendation,formula_version,gate_state,decision_evidence_json)
              VALUES ($1,$2,1,$3,'ASM-050/coverage-first-v1','PASSED',$4) ON CONFLICT DO NOTHING`, [assessmentId, stored.domainArtifactId, assessment.recommendation, JSON.stringify({ assessmentRef, matrixId: assessment.matrixId, matrixChecksum: assessment.matrixChecksum, verificationRef: assessment.verificationRef, coverageSummary: assessment.coverageSummary, warnings: assessment.warnings ?? [] })]);
          return { artifactRef: stored.artifactRef, checksum: stored.checksum };
        },
      },
      pdf: {
        render: async () => {
          if (!artifactStore) throw new Error("PRODUCTION_REPORT_STAGE_CONTEXT_NOT_PROVISIONED");
          const existing = (await artifactsFor("candidate.report/v1")).flatMap((artifact) =>
            artifact.artifactRef.includes("report-candidate-report") ? [{ ...artifact, type: "candidate-report" as const }] : []);
          if (existing.length === 1 && existing[0]?.type === "candidate-report") return existing[0];
          const validatedRef = await latestArtifact("candidate.validation/v1");
          const validated = await artifactStore.getJson<{ assessmentRef?: string; recommendation?: ReportModel["recommendation"]; workflowVersion?: string; matrixId?: string; matrixChecksum?: string }>(validatedRef);
          if (!validated.assessmentRef || !validated.recommendation) throw new Error("VALIDATED_ASSESSMENT_REFERENCE_MISSING");
          const assessment = await artifactStore.getJson<{ evidenceRef?: string; structuredAssessment?: Record<string, unknown>; profileVersion?: string; matrixId?: string; matrixChecksum?: string; skillVersions?: Record<string, string>; policyVersions?: { compiler?: string } }>(validated.assessmentRef);
          if (!assessment.evidenceRef || !assessment.structuredAssessment) throw new Error("ASSESSMENT_REPORT_INPUT_INVALID");
          const evidence = await artifactStore.getJson<{ facts?: EvidenceFact[]; conflicts?: Array<{ factIds?: string[]; resolved?: boolean }>; claimsRef?: string }>(assessment.evidenceRef);
          const matrixClaimBundle = evidence.claimsRef ? await artifactStore.getJson<{ claims?: CandidateSourceClaim[] }>(evidence.claimsRef) : {};
          const matrixClaims = Array.isArray(matrixClaimBundle.claims) ? matrixClaimBundle.claims : [];
          const facts = evidence.facts ?? [];
          const context = await vacancyContext();
          const candidateName = typeof context.candidate.name === "string" ? context.candidate.name : `Кандидат ${candidate.public_id ?? candidatePk}`;
          const vacancyId = typeof context.candidate.vacancyId === "string" ? context.candidate.vacancyId : "vacancy-unbound";
          const vacancyTitle = context.vacancy && typeof context.vacancy.title === "string" ? context.vacancy.title : String(context.candidate.vacancy ?? "Вакансия");
          const nextVersion = (await queryOne<{ next_version: number }>(input.database,
            "SELECT COALESCE(MAX(analysis_version),0)+1 AS next_version FROM candidate_report_versions WHERE candidate_id=$1", [candidatePk]))?.next_version ?? 1;
          const structured = assessment.structuredAssessment;
          const matrixRows = Array.isArray(structured.matrixRows) ? structured.matrixRows as CandidateMatrixRow[] : [];
          const matrixCriteria = structured.matrixCriteria && typeof structured.matrixCriteria === "object" && !Array.isArray(structured.matrixCriteria) ? structured.matrixCriteria as Record<string, { sourceText?: string; interpretation?: string; interpretationNotes?: string[]; sourceRefs?: string[] }> : {};
          const matrixConflicts = Array.isArray(structured.matrixConflicts) ? structured.matrixConflicts : [];
          const matrixClaimById = new Map(matrixClaims.map((claim) => [claim.claimId, claim]));
          const matrixClaimSource = (claim: CandidateSourceClaim) => {
            const locator = claim.locator;
            const page = locator.match(/(?:page|стр(?:аница)?)[=:](\d+)/iu)?.[1];
            const utterance = locator.match(/(?:utterance(?:Id)?|реплик[аи])\s*[=:]\s*(?:utterance-)?(\d+)/iu)?.[1];
            const startMs = Number(locator.match(/(?:startMs|start)\s*[=:]\s*(\d+)/iu)?.[1]);
            const endMs = Number(locator.match(/(?:endMs|end)\s*[=:]\s*(\d+)/iu)?.[1]);
            const sourceLine = locator.match(/(?:sourceLine|строк[аи])\s*[=:]\s*(\d+)/iu)?.[1];
            const formatTime = (value: number) => `${String(Math.floor(value / 60_000)).padStart(2, "0")}:${String(Math.floor((value % 60_000) / 1_000)).padStart(2, "0")}`;
            const interval = Number.isFinite(startMs) ? `${formatTime(startMs)}${Number.isFinite(endMs) && endMs > startMs ? `–${formatTime(endMs)}` : ""}` : undefined;
            const lowered = `${claim.sourceClass} ${locator}`.toLocaleLowerCase("ru");
            if (/interview|transcript|интервью|стенограмм/u.test(lowered)) return ["Интервью", sourceLine ? `строка ${sourceLine}` : interval, !sourceLine && !interval && utterance ? `реплика ${utterance}` : undefined].filter(Boolean).join(" · ");
            if (/resume|резюме/u.test(lowered)) return ["Резюме", page ? `стр. ${page}` : undefined].filter(Boolean).join(" · ");
            if (/recommend|рекомендац/u.test(lowered)) return ["Рекомендация", page ? `стр. ${page}` : undefined].filter(Boolean).join(" · ");
            return ["Документ кандидата", page ? `стр. ${page}` : undefined].filter(Boolean).join(" · ");
          };
          const matrixTextForRow = (row: CandidateMatrixRow) => {
            const ids = [...row.supportingClaimIds, ...row.contradictingClaimIds];
            const cited = ids.map((id) => matrixClaimById.get(id)).filter((claim): claim is CandidateSourceClaim => Boolean(claim));
            const evidenceText = cited.map((claim) => `${matrixClaimSource(claim)} — «${claim.text}»`).join("; ");
            return `${row.state}. Вывод: ${row.conclusion ?? row.reason}.${evidenceText ? ` Доказательства: ${evidenceText}.` : ""}${row.missingData ? ` Недостаёт: ${row.missingData}.` : ""}${row.followUpQuestion ? ` Вопрос: ${row.followUpQuestion}` : ""}`;
          };
          const matrixText = `Оценены все пункты вакансии: ${matrixRows.length}.`;
          const clean = (value: unknown, maximum = 150) => {
            const normalized = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
            return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum - 1).trimEnd()}…`;
          };
          const reportText = (value: unknown) => typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
          const factById = new Map(facts.map((fact) => [fact.id, fact]));
          const factValues = (patterns: readonly RegExp[]) => facts
            .filter((fact) => patterns.some((pattern) => pattern.test(fact.predicate)))
            .map((fact) => clean(fact.value, 240))
            .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
          const firstFactValue = (...patterns: RegExp[]) => factValues(patterns)[0] ?? "";
          const resumeFact = facts.find((fact) => fact.locator.kind === "document"
            && (/резюме/i.test(String(fact.locator.fileName ?? ""))
              || /ФИО|Компания последнего места работы|Резюме обновлено/u.test(String(fact.locator.exactText ?? ""))));
          const documentText = resumeFact?.locator.exactText
            ?? facts.find((fact) => fact.locator.kind === "document" && fact.locator.exactText)?.locator.exactText
            ?? "";
          const fullName = documentText.match(/\b([А-ЯЁ][а-яё]{2,})\s+([А-ЯЁ][а-яё]{2,})(?=\s+(?:Женщина|Мужчина|\d{2}\s+лет))/u)?.slice(1, 3).join(" ") ?? candidateName;
          const age = documentText.match(/\b(\d{2})\s+лет\b/u)?.[1] ?? "Не указан";
          const normalizedSource = documentText.replace(/\s+/g, " ").trim();
          const employer = normalizedSource.match(/Компания последнего места работы\s+(.+?)\s+Должность на последнем месте/u)?.[1]
            ?? firstFactValue(/employmentStability\.lastRoleContext/i, /required_experience\.executive_support/i)
            ?? "Не указано";
          const role = normalizedSource.match(/Должность на последнем месте работы\s+(.+?)\s+Опыт на последнем месте работы/u)?.[1] ?? "Не указано";
          const employmentPeriod = normalizedSource.match(/Опыт на последнем месте работы\s+(.+?)\s+Резюме обновлено/u)?.[1] ?? "Не указано";
          const manifest = await materialManifest();
          const reportSourceMaterials = projectReportSourceMaterials(manifest);
          const interviewMaterial = manifest.entries?.find((entry) => entry.role === "interview");
          const interviewName = interviewMaterial?.name ?? "";
          const interviewDateMatch = interviewName.match(/\b(\d{1,2})[.\-_](\d{1,2})(?:[.\-_](\d{2,4}))?\b/);
          const interviewYear = interviewDateMatch?.[3]
            ? Number(interviewDateMatch[3]) + (Number(interviewDateMatch[3]) < 100 ? 2000 : 0)
            : new Date(interviewMaterial?.modifiedTime ?? new Date().toISOString()).getUTCFullYear();
          const interviewDate = interviewDateMatch
            ? `${interviewDateMatch[1].padStart(2, "0")}.${interviewDateMatch[2].padStart(2, "0")}.${interviewYear}`
            : new Date(interviewMaterial?.modifiedTime ?? new Date().toISOString()).toLocaleDateString("ru-RU", { timeZone: "UTC" });
          const source = (fact: EvidenceFact) => {
            const locator = fact.locator;
            if (locator.kind === "transcript") {
              if (locator.timingOrigin === "derived-line-order" && locator.sourceLine) {
                return `Стенограмма; ${locator.speakerLabel ?? "Спикер"}; строка ${locator.sourceLine} — «${reportText(locator.exactText)}»`;
              }
              const start = Number(locator.startMs ?? 0);
              const end = Number(locator.endMs ?? start);
              const minutes = Math.floor(start / 60_000);
              const seconds = Math.floor((start % 60_000) / 1_000);
              const endMinutes = Math.floor(end / 60_000);
              const endSeconds = Math.floor((end % 60_000) / 1_000);
              return `Запись ${locator.recordingId}, версия ${locator.recordingVersion}; ${locator.speakerLabel ?? "Спикер"} ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}–${String(endMinutes).padStart(2, "0")}:${String(endSeconds).padStart(2, "0")} — «${reportText(locator.exactText)}»`;
            }
            return `${locator.fileName ?? "Документ"}; ID файла ${locator.fileId}; версия ${locator.fileVersion}${locator.page ? `; стр. ${locator.page}` : ""}${locator.paragraph ? `; абзац ${locator.paragraph}` : ""}${locator.section ? `; раздел «${locator.section}»` : "; раздел не определён"} — «${reportText(locator.exactText)}»`;
          };
          const assessmentItems = (value: unknown, includeSource = false) => Array.isArray(value) ? value.flatMap((entry) => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
            const item = entry as Record<string, unknown>;
            const name = [item.name, item.title, item.value, item.condition].find((candidateValue) => typeof candidateValue === "string" && candidateValue.trim());
            if (typeof name !== "string") return [];
            const factIds = Array.isArray(item.factIds) ? item.factIds.filter((id): id is string => typeof id === "string") : [];
            const cited = factIds.map((id) => factById.get(id)).find((fact): fact is EvidenceFact => Boolean(fact));
            return [`• ${reportText(name)}${typeof item.state === "string" ? ` [${item.state}]` : ""}${typeof item.reason === "string" ? ` — ${reportText(item.reason)}` : ""}${includeSource && cited ? ` Источник: ${source(cited)}` : ""}`];
          }) : [];
          const listOrState = (value: unknown, empty = "Недостаточно данных") => assessmentItems(value).join("\n") || empty;
          const abcStates = structured.abcStates && typeof structured.abcStates === "object" && !Array.isArray(structured.abcStates)
            ? structured.abcStates as Record<string, unknown> : {};
          const abcEvidence = structured.abcEvidence && typeof structured.abcEvidence === "object" && !Array.isArray(structured.abcEvidence)
            ? structured.abcEvidence as Record<string, unknown> : {};
          const directionNames: Readonly<Record<string, string>> = {
            productivity: "Продуктивность",
            initiative: "Инициатива",
            "self-learning": "Самообучаемость",
            "corporate-values": "Корпоративные ценности",
            autonomy: "Автономность",
          };
          const profileAbcDirections = Array.isArray(context.vacancy?.abcDirections)
            ? context.vacancy.abcDirections.filter((direction): direction is Record<string, unknown> => Boolean(direction && typeof direction === "object" && !Array.isArray(direction) && typeof (direction as Record<string, unknown>).id === "string"))
            : [];
          const directionIds = profileAbcDirections.length ? profileAbcDirections.map((direction) => String(direction.id)) : Object.keys(abcStates);
          const abcText = directionIds.map((direction) => {
            const grade = abcStates[direction] ?? "Недостаточно данных";
            const basis = abcEvidence[direction] && typeof abcEvidence[direction] === "object" && !Array.isArray(abcEvidence[direction]) ? abcEvidence[direction] as Record<string, unknown> : {};
            const profileDirection = profileAbcDirections.find((item) => item.id === direction);
            const name = [profileDirection?.name, profileDirection?.title, directionNames[direction], direction].find((value) => typeof value === "string" && value.trim()) as string;
            const factIds = Array.isArray(basis.factIds) ? basis.factIds.filter((id): id is string => typeof id === "string") : [];
            const sources = factIds.map((id) => factById.get(id)).filter((fact): fact is EvidenceFact => Boolean(fact)).map(source);
            return `• ${name}: ${String(grade)}${typeof basis.reason === "string" ? ` — ${reportText(basis.reason)}` : " — Недостаточно данных для объяснения оценки."}${sources.length ? ` Доказательства: ${sources.join("; ")}` : " Доказательства: допустимые источники отсутствуют."}`;
          }).join("\n") || "Недостаточно данных для оценки ABC.";
          const scaleText = profileAbcDirections.length ? profileAbcDirections.map((direction) => {
            const name = [direction.name, direction.title, directionNames[String(direction.id)], direction.id].find((value) => typeof value === "string" && value.trim());
            return `• ${String(name)}: A — ${reportText(direction.gradeA) || "выраженное поведение выше ожиданий роли"}; B — ${reportText(direction.gradeB) || "устойчивое соответствие ожиданиям роли"}; C — ${reportText(direction.gradeC) || "поведение ниже ожиданий или требующее заметной поддержки"}.`;
          }).join("\n") : "A — выше ожиданий; B — соответствует ожиданиям; C — ниже ожиданий; CONFLICT — источники противоречат друг другу; Недостаточно данных — допустимых доказательств недостаточно.";
          const abcFactIds = new Set(Object.values(abcEvidence).flatMap((value) => value && typeof value === "object" && !Array.isArray(value) && Array.isArray((value as Record<string, unknown>).factIds)
            ? (value as Record<string, unknown>).factIds as unknown[] : []).filter((id): id is string => typeof id === "string"));
          const abcFacts = facts.filter((fact) => abcFactIds.has(fact.id));
          const evidenceText = (abcFacts.length ? abcFacts : facts).map((fact) => `• ${reportText(fact.predicate)}: ${reportText(fact.value)}. ${source(fact)}`).join("\n") || "Подтверждённые факты не извлечены; вывод ограничен недостаточностью данных.";
          const conflictsText = (evidence.conflicts ?? []).map((conflict, index) => {
            const conflictFacts = (conflict.factIds ?? []).map((id) => factById.get(id)).filter((fact): fact is EvidenceFact => Boolean(fact));
            return `• Противоречие ${index + 1}${conflict.resolved ? " (разрешено)" : " (не разрешено)"}: ${conflictFacts.map((fact) => `${reportText(fact.value)} — ${source(fact)}`).join("; ") || "связанные доказательства отсутствуют"}.`;
          }).join("\n") || "Противоречия источников не зафиксированы.";
          const confirmedCompetencies = Array.isArray(structured.competencies) ? structured.competencies.filter((item) => item && typeof item === "object" && !Array.isArray(item)
            && ["Подтверждено", "Частично подтверждено"].includes(String((item as Record<string, unknown>).state ?? ""))) : [];
          const questions = [...assessmentItems(structured.competencies), ...assessmentItems(structured.accessToKe)]
            .filter((item) => /Недостаточно|Не подтверждено|Частично/i.test(item)).map((item) => item.replace(/^• /, "• Уточнить: ")).join("\n") || "• Уточнить мотивацию, ожидаемый результат и условия следующего этапа.";
          const stripAssessmentMarker = (value: string) => value.replace(/^•\s*/, "").replace(/\s*\[[^\]]+]\s*/g, " ").replace(/\s+/g, " ").trim();
          const reportClaimValues = (sourceClass: string) => matrixClaims.filter((claim) => claim.sourceClass === sourceClass)
            .map((claim) => reportText(claim.text)).filter((value, index, values) => value && values.indexOf(value) === index);
          const hardSkills = [...factValues([
            /^required[_A-Z]?experience/i, /^requiredExperience/i, /^experience\./i,
            /^competency\.(?:digitalAndAI|taskSystems|english|analytics|confidentiality|process_standardization|coordination)/i,
          ]), ...reportClaimValues("report.technical")].filter((value, index, values) => value && values.indexOf(value) === index).slice(0, 9);
          const softSkills = factValues([
            /^competency\.(?:autonomy|adaptability|accountability|initiative|businessCommunication)/i,
            /^abc\.(?:initiative|self_learning)/i, /^ABC\.(?:selfLearning|initiative|autonomy)/i,
            /^motivation\.service_role/i,
          ]).slice(0, 7);
          const positives = [
            ...factValues([/^reference\.personal_assistance/i, /^result\./i, /^personalResult\./i, /^abc\.productivity_result/i]),
            ...assessmentItems(confirmedCompetencies).map(stripAssessmentMarker),
          ].filter((value, index, values) => value && values.indexOf(value) === index).slice(0, 4);
          const negatives = [
            firstFactValue(/^stopFactor\.compensationExpectation/i, /^conditions\.compensation/i),
            ...assessmentItems(structured.stopFactors).map(stripAssessmentMarker),
            ...assessmentItems(structured.risks).map(stripAssessmentMarker),
          ].filter((value, index, values) => value && values.indexOf(value) === index).slice(0, 4);
          const additional = [...factValues([
            /^motivation\.(?:long_term|manager_match|role_focus|service_role)/i,
            /^conditions\.(?:location_and_mobility|mobility)/i,
            /^references\.availability/i,
          ]), ...reportClaimValues("report.motivation")].filter((value, index, values) => value && values.indexOf(value) === index).slice(0, 4);
          const organizationalConditions = projectOrganizationalConditions(facts, matrixClaims);
          const reportEvidenceIds = new Set(matrixRows.flatMap((row) => [...row.supportingClaimIds, ...row.contradictingClaimIds]));
          const collectReportEvidenceIds = (value: unknown, key = "") => {
            if (Array.isArray(value)) {
              if (/^(?:factIds|evidenceIds|evidenceLocatorIds|supportingClaimIds|contradictingClaimIds)$/i.test(key)) {
                value.forEach((item) => { if (typeof item === "string") reportEvidenceIds.add(item); });
              } else value.forEach((item) => collectReportEvidenceIds(item));
            } else if (value && typeof value === "object") Object.entries(value as Record<string, unknown>).forEach(([childKey, item]) => collectReportEvidenceIds(item, childKey));
          };
          collectReportEvidenceIds(structured);
          matrixClaims.filter((claim) => claim.sourceClass.startsWith("report.")).forEach((claim) => reportEvidenceIds.add(claim.claimId));
          const reportEvidenceCatalog = [
            ...matrixClaims.filter((claim) => reportEvidenceIds.has(claim.claimId)).map((claim) => ({ evidenceId: claim.claimId, quote: reportText(claim.text), source: matrixClaimSource(claim) })),
            ...facts.filter((fact) => reportEvidenceIds.has(fact.id)).map((fact) => ({ evidenceId: fact.id, quote: reportText(fact.locator.exactText || fact.value), source: fact.locator.kind === "transcript"
              ? fact.locator.timingOrigin === "derived-line-order" && fact.locator.sourceLine
                ? `Интервью · строка ${fact.locator.sourceLine}`
                : `Интервью · ${Math.floor(Number(fact.locator.startMs ?? 0) / 60_000)}:${String(Math.floor((Number(fact.locator.startMs ?? 0) % 60_000) / 1_000)).padStart(2, "0")}`
              : `${fact.locator.fileName ?? "Документ"}${fact.locator.page ? ` · стр. ${fact.locator.page}` : ""}` })),
          ].filter((item, index, items) => item.evidenceId && item.quote && items.findIndex((candidateItem) => candidateItem.evidenceId === item.evidenceId) === index).slice(0, 160);
          const abcGrades = Object.fromEntries(Object.entries(abcStates).map(([directionId, grade]) => [directionId, String(grade)]));
          const decisionSnapshot = {
            recommendation: validated.recommendation,
            abcGrades,
            matrixRows: matrixRows.map((row) => ({ criterionId: row.criterionId, state: row.state, conclusion: row.conclusion ?? row.reason,
              evidenceIds: [...row.supportingClaimIds, ...row.contradictingClaimIds] })),
          };
          const recommendationReason = reportText(structured.recommendationReason)
            || assessmentItems(structured.stopFactors)[0]?.replace(/^• /, "")
            || assessmentItems(structured.risks)[0]?.replace(/^• /, "")
            || "Рекомендация сформирована по совокупности проверенных критериев вакансии.";
          const composedReport = await composeCandidateReportFailSoft({ decisionSnapshot, evidenceCatalog: reportEvidenceCatalog, composer: async () => {
            if (!llmDependencies) throw new Error("REPORT_COMPOSER_RUNTIME_MISSING");
            const capability = "candidate_report_composer" as const;
            const config = llmDependencies.configuration.resolve(capability);
            const compactContext = {
              schemaVersion: "candidate-report-composer-input/v2",
              candidate: { displayName: fullName, vacancyTitle },
              recommendation: validated.recommendation,
              recommendationReason,
              abc: directionIds.map((directionId) => ({ directionId, title: directionNames[directionId] ?? directionId, grade: String(abcStates[directionId] ?? "Недостаточно данных") })),
              matrix: matrixRows.map((row) => ({ criterionId: row.criterionId, title: matrixCriteria[row.criterionId]?.sourceText ?? "Пункт вакансии", state: row.state,
                conclusion: row.conclusion ?? row.reason, evidenceIds: [...row.supportingClaimIds, ...row.contradictingClaimIds] })),
              evidenceCatalog: reportEvidenceCatalog,
            };
            const correlation = traceCorrelation(capability, "candidate-report");
            const attempt = await runLlmCapabilityWithPolicy(llmDependencies, llmBudget, { capability, correlation,
              request: { messages: [{ role: "system", content: config.prompt.template }, { role: "user", content: compactContext }] as JsonValue[], toolDefinitions: [] },
              inputSnapshot: { materials: [], context: JSON.parse(JSON.stringify(compactContext)) as JsonValue } });
            const output = attempt.response.normalizedOutput as Record<string, unknown>;
            const echo = output.decisionEcho as Record<string, unknown> | undefined;
            const expectedAbc = directionIds.map((directionId) => ({ directionId, grade: String(abcStates[directionId] ?? "Недостаточно данных") }));
            const expectedRows = matrixRows.map((row) => ({ criterionId: row.criterionId, state: row.state }));
            if (!echo || echo.recommendation !== validated.recommendation || JSON.stringify(echo.abc) !== JSON.stringify(expectedAbc)
              || JSON.stringify(echo.matrixRows) !== JSON.stringify(expectedRows)) throw new Error("REPORT_COMPOSER_DECISION_MUTATION");
            const narrative = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as { text: string; evidenceIds: string[] } : undefined;
            const narrativeArray = (value: unknown) => Array.isArray(value) ? value.flatMap((item) => narrative(item) ? [narrative(item)!] : []) : [];
            const section = (sectionId: string, statements: Array<{ text: string; evidenceIds: string[] }> | undefined) => statements?.length ? [{ sectionId, statements }] : [];
            const technicalNarratives = Array.isArray(output.technicalCheck) ? output.technicalCheck.flatMap((item) => {
              if (!item || typeof item !== "object" || Array.isArray(item)) return [];
              const value = item as Record<string, unknown>;
              const heading = typeof value.heading === "string" ? reportText(value.heading) : "";
              const text = typeof value.text === "string" ? reportText(value.text) : "";
              const evidenceIds = Array.isArray(value.evidenceIds) ? value.evidenceIds.filter((id): id is string => typeof id === "string") : [];
              return heading && text ? [{ text: `${heading} — ${text}`, evidenceIds }] : [];
            }) : [];
            return { decisionSnapshot, sections: [
              ...section("review", narrative(output.review) ? [narrative(output.review)!] : undefined),
              ...section("key-evidence", narrativeArray(output.keyEvidence)),
              ...section("technical-check", technicalNarratives),
              ...section("motivation-fit", narrativeArray(output.motivationFit)),
              ...section("risks", narrativeArray(output.risks)),
              ...section("decision", narrative(output.decision) ? [narrative(output.decision)!] : undefined),
              ...section("final-summary", narrative(output.finalSummary) ? [narrative(output.finalSummary)!] : undefined),
            ] };
          } });
          const evidenceSourceById = new Map(reportEvidenceCatalog.map((item) => [item.evidenceId, item.source]));
          const statementText = (statement: { text: string; evidenceIds: string[] }) => {
            const sources = [...new Set(statement.evidenceIds.map((id) => evidenceSourceById.get(id)).filter((source): source is string => Boolean(source)))];
            return `• ${statement.text}${sources.length ? `\n  Источник: ${sources.join("; ")}` : ""}`;
          };
          const composedBody = new Map((composedReport.usedFallback ? [] : composedReport.model.sections).map((section) => [section.sectionId,
            section.statements.map(statementText).join("\n")]));
          const rowEvidenceSources = (row: CandidateMatrixRow) => [...new Set([...row.supportingClaimIds, ...row.contradictingClaimIds]
            .map((id) => evidenceSourceById.get(id)).filter((source): source is string => Boolean(source)))];
          const evidenceBackedRows = matrixRows.filter((row) => row.supportingClaimIds.length || row.contradictingClaimIds.length);
          const compactRow = (row: CandidateMatrixRow) => {
            const sources = rowEvidenceSources(row);
            return `• ${row.conclusion ?? row.reason}${sources.length ? `\n  Источник: ${sources.join("; ")}` : ""}`;
          };
          const fallbackKeyEvidence = evidenceBackedRows.slice(0, 5).map(compactRow).join("\n")
            || "Показательные доказательства в доступных материалах не выделены.";
          const nextAction = validated.recommendation === "Не рекомендовать"
            ? "Зафиксировать причины отказа и завершить рассмотрение кандидата."
            : "Перейти к следующему этапу отбора, проверив отмеченные риски и зоны уточнения.";
          const positiveRows = evidenceBackedRows.filter((row) => row.state === "Соответствует");
          const attentionRows = evidenceBackedRows.filter((row) => row.state !== "Соответствует");
          const fallbackFinalSummary = [
            positiveRows[0] ? `Сильнейшее подтверждённое соответствие: ${positiveRows[0].conclusion ?? positiveRows[0].reason}` : "",
            attentionRows[0] ? `Основная зона внимания: ${attentionRows[0].conclusion ?? attentionRows[0].reason}` : "",
            nextAction,
          ].filter(Boolean).join(" ");
          const bodyFor = (section: string) => {
            if (section === "identity") return `${candidateName}; вакансия «${vacancyTitle}».`;
            if (section === "sources") return projectCandidateReportSourceLines(reportSourceMaterials).join("\n") || "Исходные материалы не указаны.";
            if (section === "organizational-conditions") return organizationalConditions.join("\n");
            if (section === "review") return composedBody.get(section) ?? (positiveRows.slice(0, 3).map(compactRow).join("\n") || recommendationReason);
            if (section === "key-evidence") return composedBody.get(section) ?? fallbackKeyEvidence;
            if (section === "technical-check") return composedBody.get(section) || (hardSkills.length ? `Профессиональные инструменты\n${hardSkills.map((item) => `• ${item}`).join("\n")}` : "Отдельный технический опыт в материалах не раскрыт.");
            if (section === "motivation-fit") return composedBody.get(section) || (additional.map((item) => `• ${item}`).join("\n") || "Отдельные сведения о мотивации и соответствии роли не выявлены.");
            if (section === "decision") return `${validated.recommendation}.\n${composedBody.get(section) ?? `${recommendationReason}\n${nextAction}`}`;
            if (section === "final-summary") return composedBody.get(section) ?? fallbackFinalSummary;
            if (section === "scale") return scaleText;
            if (section === "evidence") return evidenceText;
            if (section === "recommendation") return `${validated.recommendation}. ${recommendationReason}`;
            if (section === "executive-summary") return composedBody.get(section) ?? recommendationReason;
            if (section === "key-cases") return composedBody.get(section) ?? ([...negatives, ...positives].map((item) => `• ${item}`).join("\n") || "Отдельные ключевые кейсы не выделены.");
            if (section === "vacancy-criteria") return matrixRows.map((row) => `• ${matrixCriteria[row.criterionId]?.sourceText ?? "Пункт вакансии"}: ${row.state}. ${row.conclusion ?? row.reason}`).join("\n") || "Критерии вакансии отсутствуют.";
            if (section === "technical-validation") return composedBody.get(section) ?? (hardSkills.map((item) => `• ${item}`).join("\n") || "Отдельная техническая проверка не проводилась.");
            if (section === "motivation") return composedBody.get(section) ?? (additional.map((item) => `• ${item}`).join("\n") || "Отдельные сведения о мотивации не выявлены.");
            if (section === "next-step") return composedBody.get(section) ?? (validated.recommendation === "Не рекомендовать" ? "Зафиксировать причины отказа и завершить рассмотрение кандидата." : "Перейти к следующему этапу отбора, проверив отмеченные вопросы и риски.");
            if (section === "stop-factors" || section === "critical-mismatches") return listOrState(structured.stopFactors, "Подтверждённые стоп-факторы не обнаружены.");
            if (section === "risks") return composedBody.get(section) ?? listOrState(structured.risks, "Существенные профессиональные риски по доступным материалам не выявлены.");
            if (section === "competencies") return listOrState(structured.competencies);
            if (section === "strengths") return assessmentItems(confirmedCompetencies).join("\n") || "Недостаточно подтверждённых данных.";
            if (section === "access-to-ke") return listOrState(structured.accessToKe, "Недостаточно данных для автоматического допуска к КЕ.");
            if (section === "directions" || section === "abc" || section === "abc-directions") return abcText;
            if (section === "confirmed-results") return assessmentItems(structured.observations).join("\n") || "Недостаточно данных о подтверждённых измеримых результатах.";
            if (section === "limitations") return questions;
            if (section === "unverified-questions" || section === "questions" || section === "ke-questions") return questions;
            if (section === "conflicts") return conflictsText;
            if (section === "interview-quality") return "Интервью обработано; предметные выводы приведены только там, где есть проверяемые фрагменты.";
            if (section === "transcription-quality") return "Технические показатели доступны в артефакте транскрипции; недостаточно данных для отдельной общей оценки качества.";
            if (section === "matrix") return matrixText || "Строки матрицы отсутствуют.";
            return "Не применимо к текущему набору материалов.";
          };
          const createModel = (): ReportModel => ({
            type: "candidate-report",
            candidateId: candidate.public_id ?? String(candidatePk),
            candidateDisplayName: fullName,
            vacancyId,
            vacancyTitle,
            profileVersion,
            analysisVersion: nextVersion,
            generatedAtUtc: new Date().toISOString(),
            recommendation: validated.recommendation!,
            workflowVersion: validated.workflowVersion,
            matrixProvenance: validated.workflowVersion?.startsWith("matrix-v") && validated.matrixId && validated.matrixChecksum ? { matrixId: validated.matrixId, checksum: validated.matrixChecksum, skillVersions: assessment.skillVersions, policyVersion: assessment.policyVersions?.compiler ?? "matrix-compiler-policy/v1" } : undefined,
            matrixRows: validated.workflowVersion?.startsWith("matrix-v") ? matrixRows : undefined,
            sections: requiredReportSections("candidate-report").map((id) => ({ id, title: reportSectionTitle("candidate-report", id), body: bodyFor(id) })),
            evidence: facts,
            decisionSnapshot,
            evidenceCatalog: reportEvidenceCatalog,
            sourceMaterials: reportSourceMaterials,
          });
          const model = createModel();
          if (!input.environment.DOCUMENT_PROCESSOR_URL || !input.environment.DOCUMENT_PROCESSOR_TOKEN) throw new Error("PRODUCTION_REPORT_PROCESSOR_NOT_PROVISIONED");
          const processorBase = new URL(input.environment.DOCUMENT_PROCESSOR_URL);
          if (input.environment.E2E_ENVIRONMENT === "local") {
            if (!loopbackOrDockerHostname(processorBase.hostname) || !["http:", "https:"].includes(processorBase.protocol)) throw new Error("LOCAL_DOCUMENT_PROCESSOR_MUST_BE_LOOPBACK");
          } else if (processorBase.protocol !== "https:" && !dockerInternalProcessorEndpoint(processorBase, "document-processor")) throw new Error("REMOTE_DOCUMENT_PROCESSOR_MUST_USE_HTTPS");
          const renderUrl = new URL("/v1/render-candidate-report", processorBase);
          const renderResponse = await fetch(renderUrl, { method: "POST",
            headers: { authorization: `Bearer ${input.environment.DOCUMENT_PROCESSOR_TOKEN}`, "content-type": "application/json" },
            body: JSON.stringify({ model }), signal: AbortSignal.timeout(5 * 60_000) });
          const rendered = await renderResponse.json() as { code?: string; report?: { type: string; checksum: string; bytesBase64: string;
            contentOraclePassed?: boolean; warningCount?: number; contentOracleWarningFingerprints?: string[] } };
          if (!renderResponse.ok) throw new Error(rendered.code ?? `REPORT_PROCESSOR_HTTP_${renderResponse.status}`);
          if (!rendered.report || rendered.report.type !== "candidate-report") throw new Error("REPORT_PROCESSOR_OUTPUT_INVALID");
          const reports: Array<{ type: string; checksum: string; artifactRef: string }> = [];
          const reportRows: Array<{ type: "candidate-report"; checksum: string; artifactRef: string; byteSize: number; fileName: string;
            contentOraclePassed: boolean; warningCount: number; contentOracleWarningFingerprints: string[] }> = [];
          for (const report of [rendered.report]) {
            if (model.type !== report.type || typeof report.bytesBase64 !== "string" || typeof report.checksum !== "string") throw new Error("REPORT_PROCESSOR_OUTPUT_INVALID");
            const bytes = new Uint8Array(Buffer.from(report.bytesBase64, "base64"));
            if (sha256(bytes) !== report.checksum) throw new Error("REPORT_PROCESSOR_CHECKSUM_MISMATCH");
            const stored = await storeBytes(`report-${report.type}`, `${operationIdentity}:${report.type}`, bytes, "application/pdf");
            if (stored.checksum !== report.checksum) throw new Error("REPORT_ARTIFACT_CHECKSUM_MISMATCH");
            reports.push({ type: report.type, checksum: stored.checksum, artifactRef: stored.artifactRef });
            reportRows.push({ type: "candidate-report", checksum: stored.checksum,
              artifactRef: stored.artifactRef, byteSize: bytes.byteLength, fileName: reportFileName(model),
              contentOraclePassed: report.contentOraclePassed === true,
              warningCount: Number(report.warningCount ?? 0),
              contentOracleWarningFingerprints: Array.isArray(report.contentOracleWarningFingerprints) ? report.contentOracleWarningFingerprints : [] });
          }
          const assessmentRow = await queryOne<{ id: string }>(input.database,
            "SELECT id FROM candidate_assessments WHERE artifact_id=(SELECT id FROM candidate_domain_artifacts WHERE payload_ref=$1 LIMIT 1)", [validatedRef]);
          if (!assessmentRow) throw new Error("VALIDATED_ASSESSMENT_DOMAIN_RECORD_MISSING");
          const reportVersionId = `report-version-${sha256([candidatePk, nextVersion]).slice(0, 24)}`;
          await withTransaction(input.database, async (transaction) => {
            await execute(transaction, `INSERT INTO candidate_report_versions
              (id,candidate_id,run_id,assessment_id,analysis_version,state,directory_identity) VALUES ($1,$2,$3,$4,$5,'VALIDATED_REPORT',$6)
              ON CONFLICT DO NOTHING`, [reportVersionId, candidatePk, runId, assessmentRow.id, nextVersion,
              `candidate:${candidatePk}:results:v${String(nextVersion).padStart(4, "0")}`]);
            for (const report of reportRows) await execute(transaction, `INSERT INTO candidate_report_documents
              (id,report_version_id,type,file_name,checksum,byte_size,validation_json) VALUES ($1,$2,$3,$4,$5,$6,$7)
              ON CONFLICT DO NOTHING`, [`report-document-${sha256([reportVersionId, report.type]).slice(0, 24)}`, reportVersionId, report.type, report.fileName,
              report.checksum, report.byteSize, JSON.stringify({ valid: true, signature: true, parse: true, requiredSections: true,
                contentOraclePassed: report.contentOraclePassed, warningCount: report.warningCount,
                contentOracleWarningFingerprints: report.contentOracleWarningFingerprints, artifactRef: report.artifactRef })]);
          });
          const report = reports[0];
          if (!report || report.type !== "candidate-report") throw new Error("CANDIDATE_REPORT_INVALID");
          return { ...report, type: "candidate-report" as const };
        },
      },
      telegram: {
        send: async (value) => {
          if (!input.environment.TELEGRAM_BOT_TOKEN || !input.environment.TELEGRAM_RECIPIENT_REFS_JSON) throw new Error("PRODUCTION_TELEGRAM_OUTBOX_NOT_PROVISIONED");
          const recipientRef = text(value.recipientRef, "TELEGRAM_RECIPIENT_REF_MISSING");
          const logicalKey = text(value.logicalKey, "TELEGRAM_LOGICAL_KEY_MISSING");
          const recipients = ServerRecipientRegistry.parse(input.environment.TELEGRAM_RECIPIENT_REFS_JSON);
          if (!recipients.resolve(recipientRef)) throw new Error("TELEGRAM_RECIPIENT_NOT_ALLOWED");
          const context = await vacancyContext();
          const report = await queryOne<{ drive_file_id: string; analysis_version: number }>(input.database, `WITH RECURSIVE run_lineage(id,depth) AS (
              SELECT $1::text,0 UNION ALL SELECT source.recovery_source_run_id,lineage.depth+1
              FROM agent_runs source JOIN run_lineage lineage ON source.id=lineage.id
              WHERE source.recovery_source_run_id IS NOT NULL AND lineage.depth<32
            ) SELECT document.drive_file_id,version.analysis_version
            FROM candidate_report_documents document JOIN candidate_report_versions version ON version.id=document.report_version_id
            JOIN run_lineage lineage ON lineage.id=version.run_id
            WHERE version.candidate_id=$2 AND version.state='PUBLISHED' AND document.type IN ('candidate-report','candidate-results')
            ORDER BY lineage.depth,version.analysis_version DESC,CASE WHEN document.type='candidate-report' THEN 0 ELSE 1 END LIMIT 1`, [runId, candidatePk]);
          if (!report?.drive_file_id) throw new Error("TELEGRAM_RESULT_REPORT_NOT_PUBLISHED");
          const assessment = await queryOne<{ recommendation: string }>(input.database, `WITH RECURSIVE run_lineage(id,depth) AS (
              SELECT $1::text,0 UNION ALL SELECT source.recovery_source_run_id,lineage.depth+1
              FROM agent_runs source JOIN run_lineage lineage ON source.id=lineage.id
              WHERE source.recovery_source_run_id IS NOT NULL AND lineage.depth<32
            ) SELECT assessment.recommendation FROM candidate_assessments assessment
            JOIN candidate_report_versions version ON version.assessment_id=assessment.id
            JOIN run_lineage lineage ON lineage.id=version.run_id
            WHERE version.candidate_id=$2 ORDER BY lineage.depth,version.analysis_version DESC LIMIT 1`, [runId, candidatePk]);
          const message = successTelegramTemplate({ candidate: String(context.candidate.name ?? candidate.public_id ?? candidatePk),
            vacancy: String(context.vacancy?.title ?? context.candidate.vacancy ?? "Вакансия"), recommendation: assessment?.recommendation ?? "Недостаточно данных",
            accessToKe: "См. подтверждённые сведения в отчёте", resultPdfUrl: `https://drive.google.com/file/d/${encodeURIComponent(report.drive_file_id)}/view` });
          const store = new PostgresNotificationStore(input.database);
          const now = new Date();
          await store.register({ candidateId: candidatePk, runId, logicalKey, type: "candidate-ready", safePayload: { message }, createdAtUtc: now.toISOString() }, [recipientRef]);
          await new NotificationDispatcher(store, recipients, new TelegramBotTransport({ token: input.environment.TELEGRAM_BOT_TOKEN }),
            (payload) => payload.message ?? "Результат анализа готов").dispatch(now);
          const delivery = await queryOne<{ state: string; attempts: number }>(input.database, `SELECT delivery.state,delivery.attempts FROM candidate_notification_deliveries delivery
            JOIN candidate_notification_events event ON event.id=delivery.event_id WHERE event.logical_key=$1 AND delivery.recipient_ref=$2`, [logicalKey, recipientRef]);
          if (delivery?.state === "SENT") return { state: "SENT", attempts: delivery.attempts };
          if (delivery?.state === "SENDING") throw new Error("TELEGRAM_DELIVERY_UNKNOWN");
          if (delivery?.state === "PENDING") throw new Error("TELEGRAM_DELIVERY_RETRYABLE");
          throw new Error("TELEGRAM_DELIVERY_FAILED");
        },
      },
    },
  };
  return { runtime, task };
}
