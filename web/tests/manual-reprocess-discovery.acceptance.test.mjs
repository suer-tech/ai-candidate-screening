import assert from "node:assert/strict";
import test from "node:test";
import { equal, runProductionDiscoveryScenario, verify } from "./helpers/production-drive-discovery-harness.mjs";

const fixture = Object.freeze({
  scenarioId: "PROD-MANUAL-REPROCESS-001",
  evidence: { synthetic: true, containsRealPersonalData: false, containsCredentials: false, containsProviderTokens: false },
  driveTickOutcomes: ["SUCCESS", "SUCCESS", "SUCCESS"],
  stableComparisons: 4,
  candidateFolder: { folderId: "drive-candidate-manual-1", vacancyFolderId: "drive-vacancy-1", displayName: "Synthetic Candidate", parentPath: "Найм/Synthetic Vacancy/Synthetic Candidate" },
  vacancy: { profileVersion: "vacancy-1:v1" },
  canonicalTaskIds: ["discovery", "documents", "transcription", "evidence", "assessment", "validation", "reports", "publication"],
  existing: {
    candidateStatus: "READY",
    candidateRevision: 7,
    inputVersionId: "input-drive-candidate-manual-1-0001-stable",
    automaticTriggerIdentity: "drive-discovery:drive-candidate-manual-1:input-drive-candidate-manual-1-0001-stable",
    automaticGoalId: "goal-automatic-1",
    automaticRunId: "run-automatic-1",
  },
  command: { action: "reprocess", expectedRevision: 7, resultingRevision: 8 },
});

test("PROD-MANUAL-REPROCESS-001: unchanged input reuses immutable goal and creates one revision-scoped manual run", async () => {
  const result = await runProductionDiscoveryScenario(fixture);
  const failures = verify(result, [
    equal("status", "SUCCEEDED"),
    equal("manualReprocess.accepted", true),
    equal("manualReprocess.inputVersionReused", fixture.existing.inputVersionId),
    equal("manualReprocess.triggerKind", "manual-reprocess"),
    equal("manualReprocess.triggerIdentity", `manual-reprocess:drive-candidate-manual-1:${fixture.existing.inputVersionId}:revision-8`),
    equal("manualReprocess.triggerDiffersFromAutomatic", true),
    equal("manualReprocess.goalReused", true),
    equal("manualReprocess.goalId", fixture.existing.automaticGoalId),
    equal("manualReprocess.newGoalsCreated", 0),
    equal("manualReprocess.runCreated", true),
    equal("manualReprocess.runDiffersFromAutomatic", true),
    equal("manualReprocess.candidateStatus", "ANALYZING"),
    equal("manualReprocess.stabilityTicksObserved", 3),
    equal("manualReprocess.runsCreatedForRevision", 1),
    equal("manualReprocess.duplicateGoals", 0),
    equal("manualReprocess.duplicateRuns", 0),
  ]);
  assert.equal(failures.length, 0, failures.join("\n"));
});
