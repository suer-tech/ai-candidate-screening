import assert from "node:assert/strict";
import test from "node:test";
import { CandidateDiscoveryCoordinator, InMemoryDiscoveryRepository } from "../server/candidate-pipeline/discovery.ts";
import { findReusableReadyInput, runProductionDriveDiscoveryWorkerConformanceScenario } from "../server/candidate-pipeline/production-discovery.ts";
import type { DriveObject } from "../server/candidate-pipeline/types.ts";

const folder = {
  folderId: "drive-candidate-fresh-manifest",
  vacancyFolderId: "drive-vacancy-synthetic",
  displayName: "Synthetic Candidate",
  parentPath: "Synthetic Vacancy/Synthetic Candidate",
};

const resume = (version = "resume-v1"): DriveObject => ({
  fileId: "resume-file",
  parentFolderId: folder.folderId,
  version,
  name: "resume.pdf",
  mimeType: "application/pdf",
  size: 4_096,
  modifiedTime: version === "resume-v1" ? "2026-08-28T07:00:00.000Z" : "2026-08-28T08:00:00.000Z",
});

const interview: DriveObject = {
  fileId: "interview-file",
  parentFolderId: folder.folderId,
  version: "interview-v1",
  name: "interview.mp4",
  mimeType: "video/mp4",
  size: 8_192,
  modifiedTime: "2026-08-28T07:00:00.000Z",
};

const addedMaterial: DriveObject = {
  fileId: "portfolio-file",
  parentFolderId: folder.folderId,
  version: "portfolio-v1",
  name: "portfolio.txt",
  mimeType: "text/plain",
  size: 512,
  modifiedTime: "2026-08-28T08:05:00.000Z",
};

function freshStableCycle(repository: InMemoryDiscoveryRepository, objects: readonly DriveObject[], minute: number) {
  // A manual revision is a distinct stability cycle. Reconstructing the coordinator
  // models that public contract without reaching into private tracker state.
  const coordinator = new CandidateDiscoveryCoordinator(repository);
  const outcomes = Array.from({ length: 4 }, (_, index) => coordinator.observe(
    folder.folderId,
    objects,
    `2026-08-28T08:${String(minute + index).padStart(2, "0")}:00.000Z`,
  ));
  return outcomes;
}

function initialVersion() {
  const repository = new InMemoryDiscoveryRepository();
  const coordinator = new CandidateDiscoveryCoordinator(repository);
  coordinator.discover([folder], "2026-08-28T07:00:00.000Z");
  const outcomes = Array.from({ length: 4 }, (_, index) => coordinator.observe(
    folder.folderId,
    [resume(), interview],
    `2026-08-28T07:0${index}:00.000Z`,
  ));
  const ready = outcomes[3];
  assert.equal(ready.state, "MATERIALS_READY");
  assert.ok(ready.inputVersion);
  return { repository, inputVersion: ready.inputVersion };
}

test("WF-043: every manual reprocess waits for a fresh four-observation live stability cycle", () => {
  const { repository } = initialVersion();
  const outcomes = freshStableCycle(repository, [resume(), interview, addedMaterial], 10);

  assert.deepEqual(outcomes.slice(0, 3).map((item) => item.state), [
    "WAITING_STABILITY",
    "WAITING_STABILITY",
    "WAITING_STABILITY",
  ]);
  assert.equal(outcomes[3]?.state, "MATERIALS_READY");
  assert.equal(outcomes[3]?.duplicate, false);
  assert.ok(outcomes[3]?.inputVersion?.manifest.entries.some((item) => item.fileId === addedMaterial.fileId));
});

test("WF-043: provider-version change at identical size creates a new immutable inputVersion", () => {
  const { repository, inputVersion: predecessor } = initialVersion();
  const outcomes = freshStableCycle(repository, [resume("resume-v2"), interview], 20);
  const current = outcomes[3];

  const failures: string[] = [];
  if (current?.state !== "MATERIALS_READY") failures.push(`fresh snapshot expected MATERIALS_READY; actual=${current?.state}`);
  if (current?.duplicate !== false) failures.push(`same-size provider-version change must not reuse predecessor; duplicate=${String(current?.duplicate)}`);
  if (current?.inputVersion?.id === predecessor.id) failures.push(`provider-version change reused old inputVersion ${predecessor.id}`);
  const existingRows = [{ id: predecessor.id, sequence: predecessor.sequence, manifest_json: JSON.stringify(predecessor.manifest), state: "MATERIALS_READY" }];
  if (findReusableReadyInput(existingRows, [resume("resume-v2"), interview]) !== undefined) {
    failures.push("full-manifest matcher treated changed provider version as the same input");
  }
  assert.deepEqual(failures, []);
});

test("WF-043/WF-042: unchanged fresh manifest may reuse failed input, while a started run stays pinned", () => {
  const { repository, inputVersion: predecessor } = initialVersion();
  const unchanged = freshStableCycle(repository, [resume(), interview], 30)[3];
  assert.equal(unchanged?.state, "MATERIALS_READY");
  assert.equal(unchanged?.duplicate, true);
  assert.equal(unchanged?.inputVersion?.id, predecessor.id, "exact full-manifest match remains selective-recovery compatible");

  const pinnedAtRunStart = structuredClone(predecessor.manifest);
  const changed = freshStableCycle(repository, [resume(), interview, addedMaterial], 40)[3];
  assert.notEqual(changed?.inputVersion?.id, predecessor.id);
  assert.deepEqual(predecessor.manifest, pinnedAtRunStart, "later live Drive changes mutated the started run input");
  assert.equal(predecessor.manifest.entries.some((item) => item.fileId === addedMaterial.fileId), false);
});

test("WF-043 application boundary: changed manual input creates exactly one goal/run only after fresh stability", async () => {
  const failures: string[] = [];
  for (const change of [
    { label: "added-file", files: [resume(), interview, addedMaterial], expectedInputVersion: "input-fresh-added" },
    { label: "same-size-provider-version", files: [resume("resume-v2"), interview], expectedInputVersion: "input-fresh-version-v2" },
  ]) {
    const result = await runProductionDriveDiscoveryWorkerConformanceScenario({
      scenarioId: "PROD-MANUAL-REPROCESS-001",
      evidence: { synthetic: true, containsRealPersonalData: false, containsCredentials: false, containsProviderTokens: false },
      candidateFolder: folder,
      vacancy: { profileVersion: "vacancy-synthetic:v1" },
      existing: {
        inputVersionId: "input-predecessor-failed",
        automaticGoalId: "goal-predecessor",
        automaticTriggerIdentity: "drive-discovery:predecessor",
        failedRunId: "run-predecessor-failed",
      },
      command: { action: "reprocess", expectedRevision: 7, resultingRevision: 8 },
      driveTickOutcomes: ["SUCCESS", "SUCCESS", "SUCCESS", "SUCCESS"],
      stableComparisons: 4,
      freshLiveSnapshots: Array.from({ length: 4 }, () => ({ complete: true, objects: change.files })),
      expectedInputVersion: change.expectedInputVersion,
    } as never);

    const manual = (result as { manualReprocess?: Record<string, unknown> }).manualReprocess;
    if (manual?.freshLiveSnapshotConfirmed !== true) failures.push(`${change.label}: manual command did not confirm a new live stable snapshot`);
    if (manual?.goalCreatedAfterStableSnapshot !== true) failures.push(`${change.label}: goal was not gated by the fresh stability cycle`);
    if (manual?.inputVersionReused !== false) failures.push(`${change.label}: changed manifest incorrectly reused predecessor inputVersion`);
    if (manual?.newGoalsCreated !== 1) failures.push(`${change.label}: expected exactly one new goal; actual=${String(manual?.newGoalsCreated)}`);
    if (manual?.runsCreatedForRevision !== 1) failures.push(`${change.label}: expected exactly one new run; actual=${String(manual?.runsCreatedForRevision)}`);
    if (manual?.candidateScopedRecoveryReused !== false) failures.push(`${change.label}: candidate-scoped failed checkpoints must not cross changed inputVersion`);
  }
  assert.deepEqual(failures, []);
});

test("WF-043 application boundary: exact fresh manifest match keeps failed-predecessor selective recovery", async () => {
  const result = await runProductionDriveDiscoveryWorkerConformanceScenario({
    scenarioId: "PROD-MANUAL-REPROCESS-001",
    evidence: { synthetic: true, containsRealPersonalData: false, containsCredentials: false, containsProviderTokens: false },
    candidateFolder: folder,
    vacancy: { profileVersion: "vacancy-synthetic:v1" },
    existing: {
      inputVersionId: "input-predecessor-failed",
      automaticGoalId: "goal-predecessor",
      automaticTriggerIdentity: "drive-discovery:predecessor",
      failedRunId: "run-predecessor-failed",
    },
    command: { action: "reprocess", expectedRevision: 7, resultingRevision: 8 },
    driveTickOutcomes: ["SUCCESS", "SUCCESS", "SUCCESS", "SUCCESS"],
    stableComparisons: 4,
    freshLiveSnapshots: Array.from({ length: 4 }, () => ({ complete: true, objects: [resume(), interview] })),
  } as never);
  const manual = (result as { manualReprocess?: Record<string, unknown> }).manualReprocess;
  assert.deepEqual({
    freshLiveSnapshotConfirmed: manual?.freshLiveSnapshotConfirmed,
    inputVersionReused: manual?.inputVersionReused,
    recoverySourceRunId: manual?.recoverySourceRunId,
    candidateScopedRecoveryReused: manual?.candidateScopedRecoveryReused,
    runsCreatedForRevision: manual?.runsCreatedForRevision,
  }, {
    freshLiveSnapshotConfirmed: true,
    inputVersionReused: "input-predecessor-failed",
    recoverySourceRunId: "run-predecessor-failed",
    candidateScopedRecoveryReused: true,
    runsCreatedForRevision: 1,
  });
});
