import assert from "node:assert/strict";
import test from "node:test";
import { cases } from "./fixtures/personal-google-drive-oauth/acceptance-cases.mjs";
import { commonChecks, runPersonalGoogleDriveOAuthConformanceScenario, verify } from "./helpers/personal-google-drive-oauth-conformance-harness.mjs";

for (const [title, fixture, checks] of cases) {
  test(`TST-120 ${fixture.scenarioId}: ${title}`, async () => {
    const result = await runPersonalGoogleDriveOAuthConformanceScenario(fixture);
    const failures = verify(result, [...commonChecks, ...checks]);
    assert.equal(failures.length, 0, failures.join("\n"));
  });
}
