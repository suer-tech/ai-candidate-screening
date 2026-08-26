import { createHash } from "node:crypto";
import type {
  AssessmentInputs,
  DriveObject,
  DriveSnapshot,
  EvidenceFact,
  ImmutableArtifact,
  MaterialManifest,
  MaterialManifestEntry,
  Recommendation,
} from "./types.ts";

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value: unknown) {
  const hash = createHash("sha256");
  if (typeof value === "string") hash.update(value);
  else if (ArrayBuffer.isView(value)) hash.update(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  else if (value instanceof ArrayBuffer) hash.update(new Uint8Array(value));
  else hash.update(canonicalize(value));
  return hash.digest("hex");
}

export function snapshotDrive(folderId: string, objects: readonly DriveObject[], capturedAtUtc: string, complete = true): DriveSnapshot {
  const inputObjects = objects.filter((item) => !item.inResultsSubtree).sort((left, right) => left.fileId.localeCompare(right.fileId));
  return Object.freeze({
    folderId,
    capturedAtUtc,
    complete,
    objects: structuredClone(inputObjects),
    fingerprint: sha256(inputObjects.map(({ fileId, size }) => ({ fileId, size }))),
  });
}

export class StabilityTracker {
  private lastFingerprint?: string;
  private stableComparisons = 0;

  reset() {
    this.lastFingerprint = undefined;
    this.stableComparisons = 0;
  }

  observe(snapshot: DriveSnapshot | { complete: false; fingerprint?: string }) {
    if (!snapshot.complete) return { stable: false, stableComparisons: this.stableComparisons, skippedProviderError: true };
    if (this.lastFingerprint === snapshot.fingerprint) this.stableComparisons += 1;
    else {
      this.lastFingerprint = snapshot.fingerprint;
      this.stableComparisons = 0;
    }
    return { stable: this.stableComparisons >= 3, stableComparisons: this.stableComparisons, skippedProviderError: false };
  }
}

const RESUME_MIME = new Set(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
const INTERVIEW_PREFIXES = ["audio/", "video/"];

export function classifyMaterials(objects: readonly DriveObject[]): MaterialManifest {
  const entries: MaterialManifestEntry[] = objects.filter((item) => !item.inResultsSubtree).map((item) => {
    const role = RESUME_MIME.has(item.mimeType) ? "resume" : INTERVIEW_PREFIXES.some((prefix) => item.mimeType.startsWith(prefix)) ? "interview" : "additional";
    return { ...item, role, supported: role !== "additional" };
  });
  const resumeIds = entries.filter((item) => item.role === "resume").map((item) => item.fileId);
  const interviewIds = entries.filter((item) => item.role === "interview").map((item) => item.fileId);
  // A candidate folder may contain a resume plus supporting PDF/DOCX documents. All are
  // processed as document evidence; only multiple interview recordings are ambiguous.
  const ambiguities = [interviewIds.length > 1 ? "MULTIPLE_INTERVIEWS" : ""].filter(Boolean);
  return Object.freeze({ entries, complete: resumeIds.length >= 1 && interviewIds.length === 1 && ambiguities.length === 0, resumeIds, interviewIds, ambiguities });
}

export function immutableInputVersion(folderId: string, snapshot: DriveSnapshot, sequence: number) {
  if (!snapshot.complete) throw new Error("INCOMPLETE_DRIVE_SNAPSHOT");
  return Object.freeze({
    id: `input-${folderId}-${String(sequence).padStart(4, "0")}-${snapshot.fingerprint.slice(0, 12)}`,
    folderId,
    sequence,
    snapshotFingerprint: snapshot.fingerprint,
    objects: structuredClone(snapshot.objects),
  });
}

export class ImmutableArtifactLedger {
  private readonly artifacts = new Map<string, ImmutableArtifact>();

  append<T>(input: Omit<ImmutableArtifact<T>, "checksum" | "createdAtUtc" | "payload"> & { payload: T; createdAtUtc?: string }): ImmutableArtifact<T> {
    if (this.artifacts.has(input.id)) throw new Error("IMMUTABLE_ARTIFACT_ID_CONFLICT");
    const artifact = Object.freeze({ ...input, payload: structuredClone(input.payload), checksum: sha256(input.payload), createdAtUtc: input.createdAtUtc ?? new Date().toISOString() }) as ImmutableArtifact<T>;
    this.artifacts.set(artifact.id, artifact);
    return artifact;
  }

  get<T>(id: string) {
    const artifact = this.artifacts.get(id);
    if (!artifact) throw new Error("ARTIFACT_NOT_FOUND");
    return structuredClone(artifact) as ImmutableArtifact<T>;
  }

  deleteByCandidate(candidateId: string) {
    for (const [id, artifact] of this.artifacts) if (artifact.candidateId === candidateId) this.artifacts.delete(id);
  }

  count(candidateId: string) {
    return [...this.artifacts.values()].filter((item) => item.candidateId === candidateId).length;
  }
}

export function assertEvidenceGraph(facts: readonly EvidenceFact[]) {
  const ids = new Set<string>();
  for (const fact of facts) {
    if (ids.has(fact.id)) throw new Error("DUPLICATE_FACT_ID");
    ids.add(fact.id);
    if (fact.significant && (!fact.locator.exactText.trim() || !fact.locator.artifactId)) throw new Error("SIGNIFICANT_CLAIM_WITHOUT_LOCATOR");
    if (fact.locator.kind === "document" && (!fact.locator.fileId || !fact.locator.fileVersion)) throw new Error("INVALID_DOCUMENT_LOCATOR");
    if (fact.locator.kind === "transcript" && (fact.locator.startMs < 0 || fact.locator.endMs <= fact.locator.startMs)) throw new Error("INVALID_TRANSCRIPT_LOCATOR");
  }
  return true;
}

export function recommendationAsm050(input: AssessmentInputs): Recommendation {
  if (input.confirmedStopFactors.length > 0) return "Не рекомендовать";
  if (input.requiredItemsInsufficient.length > 0 || input.unresolvedConflicts.length > 0) return "Недостаточно данных";
  if (input.limitations.length > 0 || input.risks.length > 0 || input.partiallyConfirmedCompetencies.length > 0) return "Рекомендовать с оговорками";
  if (input.requiredExperienceConfirmed && input.accessToKePositive) return "Рекомендовать";
  return "Недостаточно данных";
}

export function configurationFingerprint(parts: Readonly<Record<string, string>>) {
  return sha256(parts);
}

export function estimateRemainingDuration(successfulComparableSamplesMs: readonly number[]) {
  if (successfulComparableSamplesMs.length < 10) return { available: false as const, display: "Недостаточно данных для прогноза" };
  const ordered = [...successfulComparableSamplesMs].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  const median = ordered.length % 2 ? ordered[middle] : Math.round((ordered[middle - 1] + ordered[middle]) / 2);
  return { available: true as const, remainingMs: median, display: `≈ ${Math.ceil(median / 60_000)} мин` };
}
