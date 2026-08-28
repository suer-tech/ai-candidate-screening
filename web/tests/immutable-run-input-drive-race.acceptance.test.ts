import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CandidateDiscoveryCoordinator, InMemoryDiscoveryRepository } from "../server/candidate-pipeline/discovery.ts";
import * as productionRuntime from "../server/candidate-pipeline/production-runtime.ts";
import { executeCandidateTool, type ProductionRuntime } from "../server/candidate-pipeline/tool-executor.ts";
import type { DriveObject, MaterialManifest } from "../server/candidate-pipeline/types.ts";

const object = (fileId: string, name: string, mimeType: string, size = 100): DriveObject => ({
  fileId, parentFolderId: "candidate-folder", version: `version-${fileId}-${size}`, name, mimeType, size,
  modifiedTime: "2026-08-28T00:00:00.000Z",
});
const resume = object("resume-pinned", "Synthetic resume.pdf", "application/pdf");
const interview = object("interview-pinned", "Synthetic interview.mp4", "video/mp4", 500);
const lateFile = object("late-document", "Late recommendation.pdf", "application/pdf", 220);

type PinnedSnapshotProjection = (input: { folderId: string; inputVersion: string; load: () => Promise<{ snapshot_id: string; manifest_json: string; state: string }> }) => Promise<{
  folderId: string;
  inputVersion: string;
  objects: DriveObject[];
}>;

test("WF-042: drive-snapshot application boundary uses only pinned manifest identities and performs zero live listing", async () => {
  const project = (productionRuntime as Record<string, unknown>).resolvePinnedRunInputSnapshot as PinnedSnapshotProjection | undefined;
  assert.equal(typeof project, "function", "public pinned run-input snapshot boundary is missing");
  const pinnedManifest: MaterialManifest = {
    entries: [
      { ...resume, role: "resume", supported: true },
      { ...interview, role: "interview", supported: true, interviewSource: "recording" },
    ],
    complete: true, resumeIds: [resume.fileId], interviewIds: [interview.fileId], ambiguities: [],
  };
  let pinnedLoads = 0;
  const pinned = await project!({ folderId: "candidate-folder", inputVersion: "input-v1", load: async () => {
    pinnedLoads += 1;
    return { snapshot_id: "snapshot-v1", manifest_json: JSON.stringify(pinnedManifest), state: "MATERIALS_READY" };
  } });
  assert.deepEqual(pinned.objects.map(({ fileId, version }) => ({ fileId, version })), [
    { fileId: resume.fileId, version: resume.version },
    { fileId: interview.fileId, version: interview.version },
  ]);
  assert.equal(pinnedLoads, 1);

  let liveListCalls = 0;
  const liveListChildren = async () => { liveListCalls += 1; return [resume, interview, lateFile]; };
  const artifactRefs: string[] = [];
  const runtime = {
    repository: {
      assertGrant: async () => true, checkpoint: async () => undefined,
      artifactReference: async ({ artifactRef }: { artifactRef: string }) => { artifactRefs.push(artifactRef); },
      outboxIntent: async () => undefined, waitForHuman: async () => undefined,
    },
    oauth: { connectionId: "synthetic", rootFolderId: "root", accessToken: async () => "synthetic-token" },
    adapters: {
      drive: { snapshot: async () => pinned, listChildren: liveListChildren, publishPdf: async () => ({}), reconcile: async () => undefined },
      routerAI: { invoke: async () => ({ artifactRef: "unused" }) },
      assemblyAI: { create: async () => ({ remoteJobId: "unused" }), poll: async () => ({ status: "completed" }) },
      pdf: { renderPair: async () => [] }, telegram: { send: async () => ({}) },
    },
  } as unknown as ProductionRuntime;
  const result = await executeCandidateTool({ mode: "production", environmentBindings: {
    CANDIDATE_PIPELINE_ROUTING: "shadow", AGENT_RUNTIME_INTERNAL_TOKEN: "synthetic", AGENT_RUNTIME_CONFIG_JSON: "{}",
    GOOGLE_OAUTH_CLIENT_ID: "synthetic", GOOGLE_OAUTH_CLIENT_SECRET: "synthetic", GOOGLE_OAUTH_REDIRECT_URI: "https://synthetic.invalid/callback",
    GOOGLE_OAUTH_DEPLOYMENT_MODE: "single-tenant", GOOGLE_OAUTH_TOKEN_KEYRING_JSON: "{}", LLM_RUNTIME_CONFIG_JSON: "{}",
    ASSEMBLYAI_API_KEY: "synthetic", ROUTERAI_API_KEY: "synthetic",
  }, runtime, toolKey: "candidate.drive-snapshot/v1", task: {
    id: "task-drive-snapshot", idempotencyIdentity: "run-v1:drive-snapshot", authorizationGrantId: "grant-v1",
    candidateId: "candidate-synthetic", candidateFolderId: "candidate-folder", inputVersion: "input-v1",
  } });
  assert.equal(result.outcome, "SUCCEEDED");
  assert.deepEqual((result.evidence?.objectIds as string[] | undefined), [resume.fileId, interview.fileId]);
  assert.equal(liveListCalls, 0, "live drive.listChildren was called after run creation");
  assert.equal(artifactRefs.length, 1, "current run did not complete its pinned drive-snapshot stage");
});

test("WF-042: production adapter reproduces candidate_input_versions manifest instead of live listChildren", () => {
  const runtimePath = fileURLToPath(new URL("../server/candidate-pipeline/production-runtime.ts", import.meta.url));
  const source = readFileSync(runtimePath, "utf8");
  const adapterStart = source.indexOf("drive: {");
  const adapterEnd = source.indexOf("routerAI:", adapterStart);
  const driveAdapter = adapterStart < 0 ? "" : source.slice(adapterStart, adapterEnd < 0 ? adapterStart + 2500 : adapterEnd);
  const failures: string[] = [];
  if (!/resolvePinnedRunInputSnapshot\(/u.test(driveAdapter)) failures.push("production drive.snapshot does not project the pinned input manifest");
  if (!/candidate_input_versions|materialManifest\(/u.test(driveAdapter)) failures.push("production drive.snapshot does not read its existing inputVersion");
  if (/drive\.listChildren\(/u.test(driveAdapter)) failures.push("production drive.snapshot still lists the live candidate folder");
  assert.deepEqual(failures, []);
});

test("WF-042: discovery sees a post-start file only as the next immutable input version", () => {
  const repository = new InMemoryDiscoveryRepository();
  const coordinator = new CandidateDiscoveryCoordinator(repository);
  coordinator.discover([{ folderId: "candidate-folder", vacancyFolderId: "vacancy-folder", displayName: "Synthetic Candidate", parentPath: "/Vacancy/Candidate" }], "2026-08-28T00:00:00Z");
  const observeStable = (objects: DriveObject[], baseMinute: number) => {
    let result: ReturnType<typeof coordinator.observe> | undefined;
    for (let index = 0; index < 4; index += 1) result = coordinator.observe("candidate-folder", objects, `2026-08-28T00:${String(baseMinute + index).padStart(2, "0")}:00Z`);
    return result!;
  };
  const first = observeStable([resume, interview], 1);
  assert.equal(first.state, "MATERIALS_READY");
  assert.equal(first.inputVersion?.sequence, 1);
  assert.deepEqual(first.inputVersion?.snapshot.objects.map((item) => item.fileId), [interview.fileId, resume.fileId]);

  const second = observeStable([resume, interview, lateFile], 10);
  assert.equal(second.state, "MATERIALS_READY");
  assert.equal(second.inputVersion?.sequence, 2);
  assert.deepEqual(second.inputVersion?.snapshot.objects.map((item) => item.fileId), [interview.fileId, lateFile.fileId, resume.fileId]);
  assert.deepEqual(first.inputVersion?.snapshot.objects.map((item) => item.fileId), [interview.fileId, resume.fileId], "first inputVersion was mutated by later discovery");
  assert.notEqual(first.inputVersion?.snapshot.fingerprint, second.inputVersion?.snapshot.fingerprint);
});
