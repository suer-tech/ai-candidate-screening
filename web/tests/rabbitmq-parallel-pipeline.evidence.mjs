import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { scenarios } from "./fixtures/rabbitmq-parallel-pipeline/synthetic-acceptance.mjs";
import { runRabbitAcceptanceScenario, startRabbitAcceptanceInfrastructure, verifyRabbitAcceptanceResult } from "./helpers/rabbitmq-parallel-pipeline-harness.mjs";

const execFileAsync = promisify(execFile);
const outputIndex = process.argv.indexOf("--output");
const outputPath = path.resolve(process.cwd(), outputIndex >= 0 ? process.argv[outputIndex + 1] : "tests/acceptance/evidence/rabbitmq-parallel-pipeline-red.json");
const timelinePath = outputPath.replace(/\.json$/i, "-timeline.md");
let infrastructure;

try {
  infrastructure = await startRabbitAcceptanceInfrastructure();
  const results = [];
  for (const fixture of Object.values(scenarios)) {
    const observed = await runRabbitAcceptanceScenario(structuredClone(fixture), infrastructure);
    results.push({ scenarioId: fixture.scenarioId, failures: verifyRabbitAcceptanceResult(observed, fixture), observed });
  }
  const { stdout: commit } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: path.resolve(import.meta.dirname, "../.."), encoding: "utf8", windowsHide: true });
  const productFailures = results.reduce((sum, item) => sum + item.failures.length, 0);
  const evidence = {
    schemaVersion: "rabbitmq-parallel-pipeline-acceptance-evidence/v1",
    capturedAtUtc: new Date().toISOString(),
    sourceCommit: commit.trim(),
    fixtureIdentity: Object.values(scenarios)[0].buildConfigFixtureIdentity,
    independentAuthorRole: "acceptance-test-subagent",
    implementationParticipation: false,
    infrastructure: infrastructure.summary,
    infrastructureErrors: 0,
    productFailures,
    status: productFailures === 0 ? "GREEN" : "RED",
    scenarios: results.map((item) => ({
      scenarioId: item.scenarioId,
      status: item.observed.status,
      safeCode: item.observed.safeCode,
      applicationBoundaryObserved: item.observed.applicationBoundaryObserved,
      failureCount: item.failures.length,
      failures: item.failures,
      timelineEvents: Array.isArray(item.observed.timeline) ? item.observed.timeline.length : 0,
    })),
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  const lines = [
    "# RabbitMQ parallel candidate pipeline — acceptance timeline",
    "",
    `- Status: **${evidence.status}**`,
    `- Captured UTC: ${evidence.capturedAtUtc}`,
    `- Source commit: \`${evidence.sourceCommit}\``,
    `- Fixture identity: \`${evidence.fixtureIdentity}\``,
    `- Real PostgreSQL write/read: ${evidence.infrastructure.postgresWriteRead}`,
    `- Real RabbitMQ publish/get: ${evidence.infrastructure.rabbitPublishGet}`,
    `- Infrastructure errors: ${evidence.infrastructureErrors}`,
    `- Product failures: ${evidence.productFailures}`,
    "",
    "| Requirement | Status | Application boundary | Safe code | Failures | Timeline events |",
    "|---|---|---:|---|---:|---:|",
    ...evidence.scenarios.map((item) => `| ${item.scenarioId} | ${item.status} | ${item.applicationBoundaryObserved} | ${item.safeCode ?? "—"} | ${item.failureCount} | ${item.timelineEvents} |`),
    "",
    "The run is a valid product RED only when both real infrastructure probes are true and `infrastructureErrors` is zero.",
    "",
  ];
  await writeFile(timelinePath, lines.join("\n"), "utf8");
  process.exitCode = productFailures === 0 ? 0 : 1;
} finally {
  await infrastructure?.stop();
}
