import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createProductionCandidateToolExecution, projectOrganizationalConditions } from "../server/candidate-pipeline/production-runtime.ts";
import { buildCriterionClaimExtractionBatches, buildCriterionClaimExtractionBatchesAsync } from "../server/candidate-pipeline/transcript-claim-batching.ts";
import { PostgresCandidateArtifactStore } from "../server/candidate-pipeline/artifact-store.ts";
import { PostgresVacancyMatrixRepository } from "../server/candidate-pipeline/matrix-postgres-repository.ts";
import { PostgresGoogleDriveOAuthRepository } from "../server/google-drive-oauth/postgres-repository.ts";
import { AdminOnlyProtectedTraceStore } from "../server/llm/protected-store.ts";
import { MATRIX_CAPABILITY_SCHEMAS } from "../server/candidate-pipeline/matrix-schemas.ts";
import type { CandidateSourceClaim } from "../server/candidate-pipeline/matrix-driven.ts";
import { renderCandidatePdf, reportSectionTitle, requiredReportSections, type ReportModel } from "../server/candidate-pipeline/reports.ts";
import { PdfJsExtractionAdapter } from "../server/candidate-pipeline/documents.ts";

const scope = { candidateId: 41, runId: "synthetic-run", inputVersion: "synthetic-input", profileVersion: "synthetic-profile" };
const matrix = { schemaVersion: "vacancy-matrix/v1", profileVersion: scope.profileVersion, criteria: [] };
const values = [
  { field: "workFormat", sourceClass: "report.organization.work-format", text: "Предпочитаю гибридный формат работы." },
  { field: "city", sourceClass: "report.organization.city", text: "Проживаю в Екатеринбурге." },
  { field: "income", sourceClass: "report.organization.income", text: "Ожидаемый доход 175 000 рублей на руки." },
  { field: "trialDay", sourceClass: "report.organization.trial-day", text: "Готов к тестовому дню в пятницу." },
  { field: "start", sourceClass: "report.organization.start", text: "Постоянно выйти на работу смогу через три недели." },
];

function syntheticEnvironment() {
  const schemas = { ...MATRIX_CAPABILITY_SCHEMAS, ocr: "candidate-claims/v1", candidate_report_composer: "candidate-claims/v1" };
  return {
    E2E_ENVIRONMENT: "local", GOOGLE_OAUTH_DEPLOYMENT_MODE: "testing",
    GOOGLE_OAUTH_CLIENT_ID: "synthetic-client", GOOGLE_OAUTH_CLIENT_SECRET: "synthetic-only",
    GOOGLE_OAUTH_REDIRECT_URI: "http://localhost:3000/api/integrations/google-drive/oauth/callback",
    GOOGLE_OAUTH_TOKEN_KEYRING_JSON: JSON.stringify({ activeVersion: "test", keys: { test: Buffer.alloc(32, 1).toString("base64url") } }),
    SYNTHETIC_LLM_KEY: "synthetic-only", CANDIDATE_PIPELINE_BUILD_ID: "synthetic-build",
    LLM_RUNTIME_CONFIG_JSON: JSON.stringify({
      releaseVersion: "synthetic-release", providers: { fixture: {
        provider: "synthetic", endpoint: "https://synthetic.invalid/llm", secretReference: "SYNTHETIC_LLM_KEY",
        apiContractVersion: "v1", supportsStructuredOutputs: true,
      } },
      capabilities: Object.fromEntries(Object.entries(schemas).map(([capability, schema]) => [capability, {
        providerProfile: "fixture", model: capability, promptArtifact: capability === "unmapped_signal_discovery" ? "discover-unmapped-signals/v1" : "extract-claims-for-criteria/v1",
        responseSchemaArtifact: schema, toolSchemaArtifacts: ["no-tools/v1"], generationParameters: { temperature: 0 },
        limits: { maxOutputTokens: 1000 }, timeoutMs: 1000,
        retryPolicy: { maxAttempts: 1, initialBackoffMs: 0, maximumBackoffMs: 0 }, fallbackPolicy: { mode: "disabled" },
      }])),
    }),
  };
}

// External adapters are isolated; requests, batching, claim normalization and
// persisted report inputs pass through the actual production application boundary.
async function executeShard(t: TestContext, kind: "transcript" | "document", excerpts = values) {
  const utterances = excerpts.map((value, index) => ({
    utteranceId: `synthetic-${index}`, speaker: "candidate", text: value.text,
    start: index * 1000, end: index * 1000 + 900,
    sourceFileId: "synthetic-interview", sourceFileVersion: "v1", sourceFileName: "Synthetic interview.txt", sourceLine: index + 1,
  }));
  const materials = { untrustedCandidateData: true, rawLocatorIdentityPreserved: true,
    documents: kind === "document" ? [{ file: { fileId: "synthetic-document", version: "v1", name: "Synthetic resume.pdf" }, text: excerpts.map((value) => value.text).join("\n"), locator: "synthetic-document:v1:page-1" }] : [],
    transcript: { normalized: { utterances: kind === "transcript" ? utterances : [] } },
  };
  const batches = buildCriterionClaimExtractionBatches({ matrix, materials, scope, maxContextTokens: 128000, countContextTokens: () => 1, overlapUtterances: 2 });
  assert.equal(batches.length, 1);
  const batch = batches[0];
  const stored = new Map<string, unknown>([["context-ref", { materials }]]);
  const requests: Record<string, unknown>[] = [];
  t.mock.method(PostgresGoogleDriveOAuthRepository.prototype, "getConnection", async () => ({ id: "synthetic-connection", state: "CONNECTED", rootFolderId: "synthetic-root" }));
  t.mock.method(PostgresVacancyMatrixRepository.prototype, "readMatrix", async () => ({ matrixId: "synthetic-matrix", matrix, checksum: "synthetic" }));
  t.mock.method(PostgresCandidateArtifactStore.prototype, "getJson", async (ref: string) => {
    assert.ok(stored.has(ref), `unexpected artifact read: ${ref}`);
    return structuredClone(stored.get(ref));
  });
  t.mock.method(PostgresCandidateArtifactStore.prototype, "putJson", async (input: { value: unknown; kind: string }) => {
    const artifactRef = `stored-${input.kind}`;
    stored.set(artifactRef, structuredClone(input.value));
    return { artifactRef, checksum: "synthetic-checksum", byteSize: JSON.stringify(input.value).length };
  });
  t.mock.method(AdminOnlyProtectedTraceStore.prototype, "write", async () => {});
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://synthetic.invalid/llm", "test must never invoke a real provider");
    const body = JSON.parse(String(init.body));
    const request = JSON.parse(body.messages[1].content);
    if (body.model === "criterion_claim_extraction") requests.push(request);
    // The fixture provider only returns report fields that the caller explicitly
    // requested and that occur in this material window, keeping missing data empty.
    const fields = Array.isArray(request.reportFieldRequests) ? request.reportFieldRequests : [];
    const claims = fields.flatMap((field: { field: string; sourceClass: string }) => {
      const value = excerpts.find((entry) => entry.field === field.field);
      return value && JSON.stringify(request.materials).includes(value.text) ? [{
        author: "Synthetic candidate", role: "candidate", roleConfidence: null,
        text: value.text, locator: kind === "document" ? "synthetic-document:v1:page-1" : `synthetic-interview:v1:line-${excerpts.indexOf(value) + 1}`,
        criterionIds: [], sourceClass: field.sourceClass, directness: "direct", relation: "CONTEXT",
      }] : [];
    });
    const output = body.model === "criterion_claim_extraction" ? { schemaVersion: "candidate-claims/v1", claims, coverage: [] } : { schemaVersion: "candidate-unmapped-signals/v1", signals: [] };
    return Response.json({ id: "synthetic-response", model: body.model, choices: [{ message: { role: "assistant", content: JSON.stringify(output) }, finish_reason: "stop" }] });
  });
  const database = {
    async unsafe(sql: string) {
      if (sql.includes("SELECT c.public_id")) return [{ public_id: "synthetic-candidate", drive_folder_id: "synthetic-folder" }];
      if (sql.includes("SELECT goal_id,workflow_version")) return [{ goal_id: "synthetic-goal", workflow_version: "matrix-v4-rabbit-parallel", trigger_identity: "synthetic-trigger" }];
      if (sql.includes("SELECT deny_checksums_json")) return [];
      if (sql.includes("SELECT record_json FROM candidates")) return [{ record_json: "{}" }];
      if (sql.includes("SELECT ref.storage_identity")) return [{ storage_identity: "context-ref" }];
      if (sql.includes("UPDATE agent_budget_ledger") || sql.includes("INSERT INTO candidate_domain_artifacts")) return { count: 1 };
      throw new Error(`Unexpected synthetic query: ${sql}`);
    },
    async begin(operation: (transaction: unknown) => Promise<unknown>) { return operation(database); },
  };
  const execution = await createProductionCandidateToolExecution({ database: database as never, environment: syntheticEnvironment() as never, task: {
    candidatePk: scope.candidateId, runId: scope.runId, inputVersion: scope.inputVersion, profileVersion: scope.profileVersion,
    id: "synthetic-task", attemptId: "synthetic-attempt", worker: "synthetic-worker", leaseToken: 1,
    authorizationGrantId: "synthetic-grant", idempotencyIdentity: "synthetic-operation", shardIdentity: batch.batchId,
    shardPayload: { batchId: batch.batchId, order: batch.order, criterionIds: [], sourceRanges: [] },
  } });
  const result = await execution.runtime.adapters.matrix!.execute("candidate.evidence-shard/v1", execution.task);
  assert.equal(requests.length, 1);
  assert.deepEqual((requests[0].reportFieldRequests as typeof values | undefined)?.filter(({ sourceClass }) => sourceClass.startsWith("report.organization.")).map(({ field, sourceClass }) => ({ field, sourceClass })), values.map(({ field, sourceClass }) => ({ field, sourceClass })), "parallel production request omitted organizational fields");
  const artifact = stored.get(result.artifactRef as string) as { claims: CandidateSourceClaim[] };
  assert.ok(artifact, "the runtime must persist the extraction artifact");
  return artifact.claims;
}

for (const kind of ["transcript", "document"] as const) {
  test(`REP-023: parallel ${kind} evidence shard preserves organizational statements for the report`, async (t) => {
    const claims = await executeShard(t, kind);
    assert.deepEqual(claims.map((claim) => claim.sourceClass), values.map((value) => value.sourceClass));
    assert.deepEqual(claims.map((claim) => claim.text), values.map((value) => value.text));
    assert.ok(claims.every((claim) => claim.runId === scope.runId && claim.inputVersion === scope.inputVersion && claim.profileVersion === scope.profileVersion && claim.locator && claim.provenanceRef && claim.criterionIds.length === 0));
    const lines = projectOrganizationalConditions([], claims);
    assert.deepEqual(lines, [
      "Формат: гибрид, Проживаю в Екатеринбурге.;",
      "Доход: Ожидаемый доход 175 000 рублей на руки.;",
      "Готов к тестовому дню: Готов к тестовому дню в пятницу.;",
      "Готов к выходу: Постоянно выйти на работу смогу через три недели.;",
    ]);
    const model: ReportModel = {
      type: "candidate-report", candidateId: "synthetic-candidate", candidateDisplayName: "Synthetic candidate",
      vacancyId: "synthetic-vacancy", vacancyTitle: "Synthetic role", profileVersion: scope.profileVersion,
      analysisVersion: 1, generatedAtUtc: "2026-10-14T00:00:00Z", recommendation: "Недостаточно данных", evidence: [],
      sections: requiredReportSections("candidate-report").map((id) => ({ id, title: reportSectionTitle("candidate-report", id), body: id === "organizational-conditions" ? lines.join("\n") : "Синтетический контекст раздела." })),
    };
    const pdfText = (await new PdfJsExtractionAdapter().extract(await renderCandidatePdf(model))).map((page) => page.text).join(" ").replace(/\s+/g, " ");
    for (const line of lines) assert.ok(pdfText.includes(line), `rendered PDF omitted grounded organizational line: ${line}`);
  });
}

test("REP-023: a trial-day statement never fills missing income, format or permanent start", async (t) => {
  const claims = await executeShard(t, "transcript", [values[3]]);
  assert.deepEqual(claims.map((claim) => claim.sourceClass), ["report.organization.trial-day"]);
  assert.deepEqual(projectOrganizationalConditions([], claims), [
    "Формат: не указано;", "Доход: не указано;",
    "Готов к тестовому дню: Готов к тестовому дню в пятницу.;", "Готов к выходу: не указано;",
  ]);
});

test("REP-023: organizational requests participate in every token count and survive all transcript windows", async () => {
  const reportFieldRequests = values.map(({ field, sourceClass, text }) => ({ field, sourceClass, instruction: text }));
  const utterances = Array.from({ length: 12 }, (_, index) => ({ utteranceId: `window-${index}`, text: "Синтетическая реплика. ".repeat(18), sourceLine: index + 1 }));
  const counted: Readonly<Record<string, unknown>>[] = [];
  const input = { matrix, scope, materials: { transcript: { normalized: { utterances } } }, reportFieldRequests,
    maxContextTokens: 2600, overlapUtterances: 1,
    countContextTokens(request: Readonly<Record<string, unknown>>) { counted.push(request); return JSON.stringify(request).length; },
  };
  const synchronous = buildCriterionClaimExtractionBatches(input);
  const asynchronous = await buildCriterionClaimExtractionBatchesAsync(input);
  assert.ok(synchronous.length > 1, "fixture must cross a context window");
  assert.deepEqual(asynchronous, synchronous);
  assert.ok(counted.length > synchronous.length);
  for (const request of counted) assert.deepEqual(request.reportFieldRequests, reportFieldRequests, "budget counted an envelope without organizational instructions");
  for (const batch of synchronous) {
    assert.deepEqual(batch.request.reportFieldRequests, reportFieldRequests);
    assert.ok(JSON.stringify(batch.request).length <= input.maxContextTokens, "emitted report-aware request exceeded its counted budget");
  }
  for (const utterance of utterances) assert.ok(synchronous.some((batch) => JSON.stringify(batch.request.materials).includes(utterance.utteranceId)), "batching omitted a candidate utterance");
});
