import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { scenarios } from "./fixtures/canonical-production-executor/synthetic-runtime.mjs";
import { runProductionExecutorScenario, verifyOracle } from "./helpers/canonical-production-executor-harness.mjs";

const outputArgument = process.argv.indexOf("--output");
if (outputArgument < 0 || !process.argv[outputArgument + 1]) throw new Error("Usage: node tests/canonical-production-executor.evidence.mjs --output <file>");

const cases = [];
for (const fixture of Object.values(scenarios)) {
  const observed = await runProductionExecutorScenario(structuredClone(fixture));
  const failures = verifyOracle(observed, fixture.oracle);
  cases.push({
    scenarioId: fixture.scenarioId,
    status: failures.length ? "RED" : "GREEN",
    productFailureCode: failures.length ? observed.executorSafeCodes[0] ?? "PRODUCTION_EXECUTOR_CONTRACT_INCOMPLETE" : null,
    failures,
    observed,
  });
}

const evidence = {
  schemaVersion: "canonical-production-executor-evidence/v1",
  change: "implement-canonical-candidate-pipeline",
  author: "independent acceptance subagent /root/canonical_pipeline_red",
  independence: "Acceptance author did not implement or edit production executor, application/server production code, schema, main specs, or change tasks.",
  fixtureSetId: "canonical-production-executor-synthetic-v1",
  dataClassification: "synthetic-no-real-pii-no-real-secrets-no-provider-expense",
  exactCommand: "cd web && node --test --test-reporter=junit --test-reporter-destination=tests/acceptance/evidence/canonical-production-executor-current-green.junit.xml tests/canonical-production-executor.acceptance.test.mjs",
  summary: {
    tests: cases.length,
    passed: cases.filter((item) => item.status === "GREEN").length,
    failed: cases.filter((item) => item.status === "RED").length,
    productRed: cases.filter((item) => item.status === "RED").length,
    productionStubRed: cases.filter((item) => item.productFailureCode === "PRODUCTION_TOOL_EXECUTOR_NOT_PROVISIONED").length,
    environmentBlocked: 0,
  },
  productRed: {
    boundary: "server/candidate-pipeline/tool-executor.ts executeCandidateTool(mode=production)",
    codes: [...new Set(cases.map((item) => item.productFailureCode).filter(Boolean))],
    scenarios: cases.filter((item) => item.status === "RED").map((item) => item.scenarioId),
  },
  initialStubRun: {
    observedBeforeConcurrentProductionMutation: true,
    tests: 5,
    passed: 0,
    failed: 5,
    code: "PRODUCTION_TOOL_EXECUTOR_NOT_PROVISIONED",
    note: "The shared production file changed after the initial run; the current JUnit/JSON artifacts intentionally describe the latest rerun.",
  },
  environmentBlockers: [],
  normativeConflict: {
    status: "BLOCKER_TO_SYNC_BEFORE_MAIN_SPEC_ACCEPTANCE",
    changeScopedContract: "proposal/design/tasks require personal Gmail/My Drive OAuth runtime and reject Shared Drive/service account",
    mainSpecContract: "INT-005 and SEC-003 require corporate Shared Drive plus service account and prohibit production dependency on personal OAuth",
    oracleTreatment: "This focused suite is change-scoped and does not modify or claim conformance with the conflicting main-spec oracle.",
  },
  cases,
};

const target = path.resolve(process.argv[outputArgument + 1]);
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output: target, summary: evidence.summary, productRed: evidence.productRed }, null, 2));
