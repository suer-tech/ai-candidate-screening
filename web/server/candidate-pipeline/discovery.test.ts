import assert from "node:assert/strict";
import test from "node:test";
import { CandidateDiscoveryCoordinator, InMemoryDiscoveryRepository } from "./discovery.ts";
import { stableCandidateId } from "./postgres-discovery.ts";

const folder = (folderId: string, displayName = "Кандидат") => ({ folderId, vacancyFolderId: "vacancy-folder-1", displayName, parentPath: `Найм/Вакансия/${displayName}` });
const complete = (size = 100) => [
  { fileId: "resume-1", parentFolderId: "folder-1", version: String(size), name: "resume.pdf", mimeType: "application/pdf", size, modifiedTime: "2026-08-20T00:00:00Z" },
  { fileId: "interview-1", parentFolderId: "folder-1", version: "1", name: "interview.mp4", mimeType: "video/mp4", size: 1000, modifiedTime: "2026-08-20T00:00:00Z" },
];

function stabilize(coordinator: CandidateDiscoveryCoordinator, objects = complete()) {
  for (let minute = 0; minute < 3; minute += 1) coordinator.observe("folder-1", objects, `2026-08-20T00:0${minute}:00Z`);
  return coordinator.observe("folder-1", objects, "2026-08-20T00:03:00Z");
}

test("rename and move retain identity while copy creates a new candidate", () => {
  const repository = new InMemoryDiscoveryRepository();
  const coordinator = new CandidateDiscoveryCoordinator(repository);
  assert.equal(coordinator.discover([folder("folder-1")], "2026-08-20T00:00:00Z")[0].type, "REGISTERED");
  assert.equal(coordinator.discover([{ ...folder("folder-1", "Новое имя"), parentPath: "Найм/Другая вакансия/Новое имя" }], "2026-08-20T00:01:00Z")[0].type, "UPDATED");
  assert.equal(repository.candidates.size, 1);
  coordinator.discover([folder("folder-copy")], "2026-08-20T00:02:00Z");
  assert.equal(repository.candidates.size, 2);
});

test("first stable complete version auto-starts and changed version waits for manual run", () => {
  const repository = new InMemoryDiscoveryRepository();
  const coordinator = new CandidateDiscoveryCoordinator(repository);
  coordinator.discover([folder("folder-1")], "2026-08-20T00:00:00Z");
  const first = stabilize(coordinator);
  assert.equal(first.state, "MATERIALS_READY");
  assert.equal(first.inputVersion.trigger, "AUTOMATIC_FIRST_RUN");
  const duplicate = coordinator.observe("folder-1", complete(), "2026-08-20T00:04:00Z");
  assert.equal(duplicate.state, "MATERIALS_READY");
  assert.equal(duplicate.duplicate, true);
  for (let minute = 5; minute < 8; minute += 1) coordinator.observe("folder-1", complete(101), `2026-08-20T00:0${minute}:00Z`);
  const changed = coordinator.observe("folder-1", complete(101), "2026-08-20T00:08:00Z");
  assert.equal(changed.state, "MATERIALS_READY");
  assert.equal(changed.inputVersion.trigger, "MANUAL_RUN_AVAILABLE");
});

test("partial upload resets stability, provider error interval is skipped, and tombstone prevents rediscovery", () => {
  const repository = new InMemoryDiscoveryRepository();
  const coordinator = new CandidateDiscoveryCoordinator(repository);
  coordinator.discover([folder("folder-1")], "2026-08-20T00:00:00Z");
  coordinator.observe("folder-1", complete(), "2026-08-20T00:00:00Z");
  assert.equal(coordinator.observe("folder-1", null, "2026-08-20T00:01:00Z").skippedProviderError, true);
  coordinator.observe("folder-1", [complete()[0]], "2026-08-20T00:02:00Z");
  for (let minute = 3; minute < 6; minute += 1) coordinator.observe("folder-1", [complete()[0]], `2026-08-20T00:0${minute}:00Z`);
  assert.equal(coordinator.observe("folder-1", [complete()[0]], "2026-08-20T00:06:00Z").state, "MATERIALS_INCOMPLETE");
  repository.deleteCandidate("folder-1");
  assert.equal(coordinator.discover([folder("folder-1")], "2026-08-20T00:07:00Z")[0].type, "SKIPPED_TOMBSTONE");
});

test("durable Drive identity always fits the PostgreSQL integer key", () => {
  for (const value of ["folder-1", "folder-with-a-different-hash", "synthetic-very-long-folder-identity"]) {
    const id = stableCandidateId(value);
    assert.ok(Number.isInteger(id));
    assert.ok(id > 0 && id <= 2_147_483_647);
    assert.equal(id, stableCandidateId(value));
  }
});
