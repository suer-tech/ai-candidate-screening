import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CANONICAL_STAGE_IDS = Object.freeze([
  "drive-discovery",
  "stability-and-input-version",
  "material-completeness",
  "document-extraction",
  "routerai-ocr",
  "media-probe-and-audio",
  "assemblyai-transcription",
  "speaker-role-mapping",
  "fact-and-evidence-extraction",
  "profile-assessment",
  "deterministic-recommendation",
  "validation-gates",
  "pdf-pair-render-and-validate",
  "personal-drive-publication",
  "telegram-outbox",
  "metrics-and-eta",
  "archive-delete-and-cleanup",
]);

const TEST_STAGE_IDS = Object.freeze({
  "E2E-VAC-001": ["drive-discovery", "stability-and-input-version", "material-completeness", "metrics-and-eta"],
  "E2E-TRN-001": ["media-probe-and-audio", "assemblyai-transcription", "speaker-role-mapping"],
  "E2E-ABC-001": ["document-extraction", "routerai-ocr", "fact-and-evidence-extraction", "profile-assessment", "validation-gates", "pdf-pair-render-and-validate"],
  "E2E-RESULT-001": ["deterministic-recommendation", "validation-gates", "pdf-pair-render-and-validate", "personal-drive-publication", "telegram-outbox", "archive-delete-and-cleanup"],
});

const fixturePath = path.resolve("tests/e2e/fixtures/canonical-candidate-v1/manifest.json");
const adapterContractPath = "server/candidate-pipeline/conformance.ts";
const adapterPath = path.resolve("server/candidate-pipeline/conformance.ts");

async function fixture() {
  return JSON.parse(await readFile(fixturePath, "utf8"));
}

function unavailableResult(manifest) {
  return {
    schemaVersion: "1.0",
    status: "NOT_IMPLEMENTED",
    evidenceScope: "local-controlled-conformance-only",
    productionLikeAcceptanceClaimed: false,
    fixtureSetId: manifest.fixtureSetId,
    dataClassification: manifest.dataClassification,
    adapter: { path: adapterContractPath, available: false },
    stages: Object.fromEntries(CANONICAL_STAGE_IDS.map((id) => [id, { status: "NOT_IMPLEMENTED", evidence: [] }])),
    cleanup: { attempted: false, complete: false },
  };
}

let cached;

export async function runCanonicalPipelineConformance() {
  if (cached) return cached;
  const manifest = await fixture();
  if (!existsSync(adapterPath)) {
    cached = unavailableResult(manifest);
    return cached;
  }
  try {
    const adapterModule = await import(`${pathToFileURL(adapterPath).href}?baseline=${Date.now()}`);
    if (typeof adapterModule.runCanonicalCandidatePipelineConformance !== "function") {
      cached = { ...unavailableResult(manifest), status: "INVALID_ADAPTER", adapter: { path: adapterContractPath, available: true, callable: false } };
      return cached;
    }
    cached = await adapterModule.runCanonicalCandidatePipelineConformance({ manifest, evidenceScope: "local-controlled-conformance-only" });
    return cached;
  } catch (error) {
    cached = {
      ...unavailableResult(manifest),
      status: "ADAPTER_ERROR",
      adapter: { path: adapterContractPath, available: true, callable: true, safeError: error instanceof Error ? error.name : "UnknownError" },
    };
    return cached;
  }
}

export function verifyCanonicalE2e(result, testId) {
  const failures = [];
  if (result.productionLikeAcceptanceClaimed !== false) failures.push("local conformance must not claim production-like acceptance");
  if (result.evidenceScope !== "local-controlled-conformance-only") failures.push(`unexpected evidenceScope ${JSON.stringify(result.evidenceScope)}`);
  if (result.status !== "SUCCEEDED") failures.push(`pipeline status: expected SUCCEEDED; actual=${JSON.stringify(result.status)}`);
  for (const stageId of TEST_STAGE_IDS[testId] ?? []) {
    const stage = result.stages?.[stageId];
    if (stage?.status !== "SUCCEEDED") failures.push(`${stageId}: expected SUCCEEDED; actual=${JSON.stringify(stage?.status)}`);
    if (!Array.isArray(stage?.evidence) || stage.evidence.length === 0) failures.push(`${stageId}: reproducible evidence is required`);
  }
  if (testId === "E2E-RESULT-001" && result.cleanup?.complete !== true) failures.push("full synthetic cleanup must complete");
  return failures;
}

export function buildCanonicalBaselineEvidence(result) {
  const tests = Object.keys(TEST_STAGE_IDS).map((testId) => {
    const failures = verifyCanonicalE2e(result, testId);
    return { testId, status: failures.length === 0 ? "PASSED" : "RED", failures };
  });
  return {
    schemaVersion: "1.0",
    generatedAtUtc: new Date().toISOString(),
    classification: "product-conformance",
    evidenceScope: result.evidenceScope,
    productionLikeAcceptanceClaimed: false,
    fixtureSetId: result.fixtureSetId,
    adapter: result.adapter,
    counts: {
      total: tests.length,
      passed: tests.filter((item) => item.status === "PASSED").length,
      red: tests.filter((item) => item.status === "RED").length,
    },
    tests,
    missingStages: CANONICAL_STAGE_IDS.filter((id) => result.stages?.[id]?.status !== "SUCCEEDED"),
    cleanup: result.cleanup,
  };
}
