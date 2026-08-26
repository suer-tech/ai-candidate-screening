import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { cases } from "./fixtures/personal-google-drive-oauth/acceptance-cases.mjs";
import { commonChecks, runPersonalGoogleDriveOAuthConformanceScenario, verify } from "./helpers/personal-google-drive-oauth-conformance-harness.mjs";

const output = process.argv.includes("--output")
  ? process.argv[process.argv.indexOf("--output") + 1]
  : "tests/acceptance/evidence/personal-google-drive-oauth-red.json";

const results = [];
for (const [title, fixture, checks] of cases) {
  const result = await runPersonalGoogleDriveOAuthConformanceScenario(fixture);
  const failures = verify(result, [...commonChecks, ...checks]);
  results.push({ testId: fixture.scenarioId, title, status: failures.length === 0 ? "PASSED" : "RED", safeCode: result.safeCode ?? null, failures });
}

const evidence = {
  schemaVersion: "1.0",
  generatedAtUtc: new Date().toISOString(),
  change: "support-personal-google-drive-oauth",
  requirement: "TST-120",
  fixtureSetId: "personal-google-drive-oauth-synthetic-v1",
  evidenceScope: "local-controlled-conformance-only",
  productionLikeAcceptanceClaimed: false,
  author: "/root/personal_drive_oauth_red",
  executor: "/root/personal_drive_oauth_red",
  independenceDeclared: true,
  containsSecrets: false,
  containsRealPersonalData: false,
  counts: { total: results.length, passed: results.filter((item) => item.status === "PASSED").length, red: results.filter((item) => item.status === "RED").length },
  results,
};

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(evidence)}\n`);
if (evidence.counts.red > 0) process.exitCode = 1;
