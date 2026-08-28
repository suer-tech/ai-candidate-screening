import { StabilityTracker, classifyMaterials, immutableInputVersion, snapshotDrive } from "./core.ts";
import type { DriveObject, DriveSnapshot, MaterialManifest } from "./types.ts";

export const DISCOVERY_INTERVAL_MS = 15_000;
export const STABILITY_INTERVAL_MS = 15_000;
export const REQUIRED_SNAPSHOTS = 4;

export function candidateFolderSnapshotShape(objects: readonly DriveObject[]) {
  const files = objects.map(({ fileId, size }) => ({ fileId, size })).sort((left, right) => left.fileId.localeCompare(right.fileId));
  const count = files.length;
  return { files, count };
}

export type CandidateFolder = { folderId: string; vacancyFolderId: string; displayName: string; parentPath: string };
export type CandidateRegistration = CandidateFolder & { candidateId: string; archived: boolean; firstSeenAtUtc: string };
export type RegisteredInputVersion = {
  id: string;
  candidateId: string;
  sequence: number;
  snapshot: DriveSnapshot;
  manifest: MaterialManifest;
  trigger: "AUTOMATIC_FIRST_RUN" | "MANUAL_RUN_AVAILABLE";
};

export interface DiscoveryRepository {
  tombstoned(folderId: string): boolean;
  candidateByFolderId(folderId: string): CandidateRegistration | undefined;
  saveCandidate(candidate: CandidateRegistration): void;
  inputVersions(candidateId: string): readonly RegisteredInputVersion[];
  saveInputVersion(version: RegisteredInputVersion): void;
}

export class InMemoryDiscoveryRepository implements DiscoveryRepository {
  readonly candidates = new Map<string, CandidateRegistration>();
  readonly versions = new Map<string, RegisteredInputVersion[]>();
  readonly tombstones = new Set<string>();

  tombstoned(folderId: string) { return this.tombstones.has(folderId); }
  candidateByFolderId(folderId: string) { const value = this.candidates.get(folderId); return value ? structuredClone(value) : undefined; }
  saveCandidate(candidate: CandidateRegistration) { this.candidates.set(candidate.folderId, structuredClone(candidate)); }
  inputVersions(candidateId: string) { return structuredClone(this.versions.get(candidateId) ?? []); }
  saveInputVersion(version: RegisteredInputVersion) { this.versions.set(version.candidateId, [...(this.versions.get(version.candidateId) ?? []), structuredClone(version)]); }
  deleteCandidate(folderId: string) { this.candidates.delete(folderId); this.tombstones.add(folderId); }
}

export class CandidateDiscoveryCoordinator {
  private readonly stability = new Map<string, StabilityTracker>();

  constructor(private readonly repository: DiscoveryRepository) {}

  discover(folders: readonly CandidateFolder[], nowUtc: string) {
    const events: Array<{ type: "REGISTERED" | "UPDATED" | "SKIPPED_TOMBSTONE"; folderId: string; candidateId?: string }> = [];
    for (const folder of folders) {
      if (this.repository.tombstoned(folder.folderId)) {
        events.push({ type: "SKIPPED_TOMBSTONE", folderId: folder.folderId });
        continue;
      }
      const current = this.repository.candidateByFolderId(folder.folderId);
      const candidate = current
        ? { ...current, displayName: folder.displayName, parentPath: folder.parentPath, vacancyFolderId: folder.vacancyFolderId }
        : { ...folder, candidateId: `candidate-${folder.folderId}`, archived: false, firstSeenAtUtc: nowUtc };
      this.repository.saveCandidate(candidate);
      events.push({ type: current ? "UPDATED" : "REGISTERED", folderId: folder.folderId, candidateId: candidate.candidateId });
    }
    return events;
  }

  observe(folderId: string, objects: readonly DriveObject[] | null, capturedAtUtc: string) {
    const candidate = this.repository.candidateByFolderId(folderId);
    if (!candidate) throw new Error("CANDIDATE_FOLDER_NOT_REGISTERED");
    const tracker = this.stability.get(folderId) ?? new StabilityTracker();
    this.stability.set(folderId, tracker);
    if (!objects) return { state: "WAITING_STABILITY" as const, skippedProviderError: tracker.observe({ complete: false }).skippedProviderError };
    const snapshot = snapshotDrive(folderId, objects, capturedAtUtc);
    const snapshotShape = candidateFolderSnapshotShape(snapshot.objects);
    if (snapshotShape.count !== snapshot.objects.length) tracker.reset();
    const observed = tracker.observe(snapshot);
    if (!observed.stable) return { state: "WAITING_STABILITY" as const, stableComparisons: observed.stableComparisons };
    const manifest = classifyMaterials(snapshot.objects);
    if (!manifest.complete) return { state: "MATERIALS_INCOMPLETE" as const, manifest };
    const existing = this.repository.inputVersions(candidate.candidateId);
    const duplicate = existing.find((version) => version.snapshot.fingerprint === snapshot.fingerprint);
    if (duplicate) return {
      state: "MATERIALS_READY" as const,
      inputVersion: duplicate,
      duplicate: true,
      observedSnapshot: snapshot,
      observedManifest: manifest,
    };
    const value = immutableInputVersion(folderId, snapshot, existing.length + 1);
    const inputVersion: RegisteredInputVersion = {
      ...value,
      candidateId: candidate.candidateId,
      snapshot,
      manifest,
      trigger: existing.length === 0 ? "AUTOMATIC_FIRST_RUN" : "MANUAL_RUN_AVAILABLE",
    };
    this.repository.saveInputVersion(inputVersion);
    return {
      state: "MATERIALS_READY" as const,
      inputVersion,
      duplicate: false,
      observedSnapshot: snapshot,
      observedManifest: manifest,
    };
  }
}
