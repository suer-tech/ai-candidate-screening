import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scenarios, syntheticCredentialSentinels, syntheticPiiSentinels } from "./fixtures/vps-postgres-runtime/synthetic-matrix.mjs";
import { runVpsPostgresAcceptanceScenario, verifyVpsPostgresOracle } from "./helpers/vps-postgres-runtime-harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory = path.join(here, "acceptance", "evidence");

const matrix = [
  { fixture: scenarios.noCloudflare, requirements: ["vps-postgres-runtime: no Cloudflare dependency/readiness", "quality-gates: production dependency contract"], purpose: "Forbid Cloudflare Workers, D1, R2, Miniflare, Wrangler, and Sites from the production graph and readiness." },
  { fixture: scenarios.postgresSchema, requirements: ["vps-postgres-runtime: PostgreSQL 16 clean/upgrade schema", "data-and-security: transactional integrity"], purpose: "Exercise clean and supported-upgrade migration contracts without production data." },
  { fixture: scenarios.postgresDurability, requirements: ["vps-postgres-runtime: concurrent claim/fencing/outbox/blob", "candidate-workflow: durable effects"], purpose: "Prove single claim, stale-worker fencing, reconciliation, atomic outbox, and bounded immutable blobs." },
  { fixture: scenarios.nodeRuntime, requirements: ["vps-postgres-runtime: Node/Nitro boundary", "integrations-and-operations: authenticated short routes"], purpose: "Require a Node target, authenticated route semantics, and background-only long work without Cloudflare bindings." },
  { fixture: scenarios.configuration, requirements: ["vps-postgres-runtime: unified configuration", "data-and-security: credential allowlist"], purpose: "Require one env file and one exact credential directory; reject inline, unknown, escaped, corporate Google, and Cloudflare settings." },
  { fixture: scenarios.privateBenchmark, requirements: ["private-candidate-benchmark: isolated offline oracle", "quality-gates: cleanup and deny-set audit"], purpose: "Prove consent-first role isolation, deny-checksum audit, offline hard oracle, and unconditional cleanup using synthetic fixtures only." },
  { fixture: scenarios.progressUi, requirements: ["candidate-workflow: server-derived progress", "quality-gates: rendered dashboard/list parity"], purpose: "Render the same server-provided 55 percent milestone in accessible dashboard and list progress bars." },
  { fixture: scenarios.frozenProfileApproval, requirements: ["private-candidate-benchmark: frozen HR-approved profile checksum", "private-candidate-benchmark: fail-closed approval gate", "quality-gates: no implicit profile regeneration"], purpose: "Require the benchmark to use only the explicitly approved immutable profile snapshot and fail closed on missing approval, checksum mismatch, or implicit regeneration before reading pipeline inputs or calling providers." },
  { fixture: scenarios.referenceDerivedProfile, requirements: ["private-candidate-benchmark: reference isolation", "private-candidate-benchmark: deny-checksum firewall", "private-candidate-benchmark: no reference-derived profile"], purpose: "Prove reference ABC/result and extracted anchors never create or mutate the profile and never reach provider payload, Drive snapshot, or blob store; the profile fingerprint stays independent of reference content." },
  { fixture: scenarios.privatePdfRetention, requirements: ["private-candidate-benchmark: private PDF review/retention/deletion", "private-candidate-benchmark: owner-only evidence retention", "quality-gates: cleanup and evidence gate"], purpose: "Require exactly two owner-only generated PDFs retained privately until review/deadline, proven deletion with aggregated evidence, and terminal RED when any cleanup phase is incomplete." },
  { fixture: scenarios.localCanonicalE2e, requirements: ["quality-gates: QG-055 local canonical E2E via PostgreSQL runtime", "quality-gates: application-boundary evidence"], purpose: "Require E2E-VAC-001/TRN-001/ABC-001/RESULT-001 through the assembled Node web/worker and durable PostgreSQL on one build/config/fixture identity; direct in-memory pipeline or SQLite fixture state does not close the gate." },
];

const infrastructurePatterns = /ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|SyntaxError|UI_TEST_DEPENDENCY_UNRESOLVED|fixture[^\n]*(?:missing|invalid|not found)/i;
const results = [];

for (const item of matrix) {
  const startedAt = new Date().toISOString();
  try {
    const actual = await runVpsPostgresAcceptanceScenario(structuredClone(item.fixture));
    const mismatches = verifyVpsPostgresOracle(actual, item.fixture.oracle);
    results.push({
      scenarioId: item.fixture.scenarioId,
      requirements: item.requirements,
      purpose: item.purpose,
      preconditions: ["synthetic fixture set only", "no provider expense", "private candidate folder access forbidden"],
      steps: item.fixture.operations ?? [item.fixture.kind],
      expected: item.fixture.oracle,
      actual,
      cleanup: item.fixture.kind === "private-benchmark" ? { requiredAfterAnyOutcome: true, complete: actual.cleanupComplete === true } : { temporaryHarnessResourcesRemoved: true },
      status: mismatches.length === 0 ? "GREEN" : "RED",
      classification: mismatches.length === 0 ? "accepted" : infrastructurePatterns.test(mismatches.join("\n")) ? "test-infrastructure" : "product-red",
      safeFailureCode: actual.safeCode ?? null,
      mismatches,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    results.push({
      scenarioId: item.fixture.scenarioId,
      requirements: item.requirements,
      purpose: item.purpose,
      status: "RED",
      classification: "test-infrastructure",
      safeFailureCode: "ACCEPTANCE_HARNESS_ERROR",
      mismatches: [message],
      startedAt,
      finishedAt: new Date().toISOString(),
    });
  }
}

const summary = {
  total: results.length,
  green: results.filter((item) => item.status === "GREEN").length,
  red: results.filter((item) => item.status === "RED").length,
  productRed: results.filter((item) => item.classification === "product-red").length,
  infrastructureErrors: results.filter((item) => item.classification === "test-infrastructure").length,
};
const phase = summary.red === 0 && summary.infrastructureErrors === 0 ? "GREEN" : "RED";
const phaseSlug = phase.toLowerCase();
const jsonPath = path.join(outputDirectory, `vps-postgres-runtime-${phaseSlug}.json`);
const timelinePath = path.join(outputDirectory, `vps-postgres-runtime-${phaseSlug}-timeline.md`);
const evidence = {
  schemaVersion: "vps-postgres-runtime-acceptance-evidence/v1",
  change: "migrate-to-vps-postgres-runtime",
  generatedAt: new Date().toISOString(),
  expectedPhase: phase,
  normativeNote: "This is change-scoped acceptance for the proposed PostgreSQL/Node/personal-My-Drive delta. Conflicting Cloudflare D1/R2 and corporate Shared Drive/service-account statements in main specs remain normative until the explicit post-GREEN sync task; this baseline does not modify or silently replace them.",
  mainSpecSyncPending: true,
  command: "node tests/vps-postgres-runtime.evidence.mjs",
  junitCommand: `node --test --test-reporter=junit --test-reporter-destination=tests/acceptance/evidence/vps-postgres-runtime-${phaseSlug}.junit.xml tests/vps-postgres-runtime.acceptance.test.mjs`,
  safety: { fixtureSetId: "vps-postgres-runtime-synthetic-v1", syntheticOnly: true, realPii: false, realSecrets: false, providerExpense: false, privateCandidateFolderRead: false },
  summary,
  results,
};

const serialized = JSON.stringify(evidence, null, 2) + "\n";
const forbiddenLeaks = [...syntheticCredentialSentinels, ...syntheticPiiSentinels].filter((sentinel) => serialized.includes(sentinel));
if (forbiddenLeaks.length > 0) throw new Error(`EVIDENCE_SENTINEL_LEAK:${forbiddenLeaks.length}`);

const timeline = [
  `# VPS/PostgreSQL runtime — independent acceptance ${phase}`,
  "",
  `Generated: ${evidence.generatedAt}`,
  "",
  "Scope: synthetic acceptance only. The private `candidate/**` folder was not read; no real PII, credentials, provider calls, or provider expense were used.",
  "",
  "Normative note: this is change-scoped acceptance for a proposed delta. Conflicting main-spec Cloudflare D1/R2 and corporate Shared Drive/service-account statements remain normative until the explicit post-GREEN sync task; this baseline changes neither.",
  "",
  `Result: **${summary.green}/${summary.total} GREEN**, ${summary.productRed} product-contract failures, ${summary.infrastructureErrors} import/fixture/harness errors.`,
  "",
  "| Scenario | Contract | Status | Classification | Safe evidence |",
  "|---|---|---:|---|---|",
  ...results.map((item) => `| ${item.scenarioId} | ${item.purpose} | ${item.status} | ${item.classification} | ${item.safeFailureCode ?? "none"} |`),
  "",
  "## Reproduction",
  "",
  "```powershell",
  "cd web",
  evidence.command,
  evidence.junitCommand,
  "```",
  "",
  "The evidence command intentionally exits non-zero while any acceptance contract is RED. JSON and timeline output are written before exit. JUnit is generated by the Node test runner. A product RED is valid only when `infrastructureErrors` remains zero.",
  "",
  "## Safety and cleanup",
  "",
  "All fixtures use reserved synthetic identities and fixed synthetic checksums. Evidence is rejected if any credential or PII sentinel is serialized. The rendered UI compiler removes its temporary directory in `finally`; the benchmark contract requires cleanup even when its offline oracle is RED.",
  "",
].join("\n");

await mkdir(outputDirectory, { recursive: true });
await Promise.all([writeFile(jsonPath, serialized, "utf8"), writeFile(timelinePath, timeline, "utf8")]);
console.log(JSON.stringify({ evidence: path.relative(here, jsonPath).replaceAll("\\", "/"), timeline: path.relative(here, timelinePath).replaceAll("\\", "/"), summary }));
if (summary.red > 0 || summary.infrastructureErrors > 0) process.exitCode = 1;
