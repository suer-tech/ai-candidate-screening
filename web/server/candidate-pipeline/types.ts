export const CANONICAL_STAGE_IDS = [
  "drive-discovery",
  "stability-and-input-version",
  "material-completeness",
  "document-extraction",
  "routerai-ocr",
  "media-probe-and-audio",
  "assemblyai-transcription",
  "speaker-role-mapping",
  "fact-and-evidence-extraction",
  "profile-assessment",
  "deterministic-recommendation",
  "validation-gates",
  "pdf-pair-render-and-validate",
  "personal-drive-publication",
  "telegram-outbox",
  "metrics-and-eta",
  "archive-delete-and-cleanup",
] as const;

export type CanonicalStageId = typeof CANONICAL_STAGE_IDS[number];
export type MaterialRole = "resume" | "interview" | "additional" | "result" | "unsupported";
export type EvidenceState = "Подтверждено" | "Частично подтверждено" | "Не подтверждено" | "Недостаточно данных" | "Противоречие источников";
export type Recommendation = "Не рекомендовать" | "Недостаточно данных" | "Рекомендовать с оговорками" | "Рекомендовать";

export type DriveObject = {
  fileId: string;
  parentFolderId: string;
  version: string;
  name: string;
  mimeType: string;
  size: number;
  modifiedTime: string;
  inResultsSubtree?: boolean;
};

export type DriveSnapshot = {
  folderId: string;
  capturedAtUtc: string;
  complete: boolean;
  objects: readonly DriveObject[];
  fingerprint: string;
};

export type MaterialManifestEntry = DriveObject & {
  role: MaterialRole;
  supported: boolean;
  interviewSource?: "recording" | "ready-transcript";
};

export type MaterialManifest = {
  entries: readonly MaterialManifestEntry[];
  complete: boolean;
  resumeIds: readonly string[];
  interviewIds: readonly string[];
  ambiguities: readonly string[];
};

export type DocumentLocator = {
  kind: "document";
  fileId: string;
  fileVersion: string;
  artifactId: string;
  fileName: string;
  exactText: string;
  page?: number;
  section?: string;
  paragraph?: number;
  textSpan?: { start: number; end: number };
  bbox?: { x: number; y: number; width: number; height: number };
  confidence?: number;
};

export type TranscriptLocator = {
  kind: "transcript";
  recordingId: string;
  recordingVersion: string;
  artifactId: string;
  speakerLabel: string;
  speakerRole?: string;
  exactText: string;
  startMs: number;
  endMs: number;
  sourceLine?: number;
  timingOrigin?: "provider" | "explicit-text" | "derived-line-order";
  confidence?: number;
};

export type EvidenceLocator = DocumentLocator | TranscriptLocator;

export type EvidenceFact = {
  id: string;
  subject: string;
  predicate: string;
  value: string;
  confidence: number;
  significant: boolean;
  locator: EvidenceLocator;
  provenance: { tool: string; toolVersion: string; schemaVersion: string; traceId: string };
};

export type AssessmentInputs = {
  confirmedStopFactors: readonly string[];
  requiredItemsInsufficient: readonly string[];
  requiredExperienceConfirmed: boolean;
  accessToKePositive: boolean;
  unresolvedConflicts: readonly string[];
  limitations: readonly string[];
  risks: readonly string[];
  partiallyConfirmedCompetencies: readonly string[];
  abcStates: Readonly<Record<string, "A" | "B" | "C" | "CONFLICT" | "Недостаточно данных">>;
};

export type ImmutableArtifact<T = unknown> = {
  id: string;
  kind: string;
  candidateId: string;
  runId: string;
  inputVersion: string;
  profileVersion: string;
  schemaVersion: string;
  configFingerprint: string;
  checksum: string;
  createdAtUtc: string;
  payload: Readonly<T>;
};

export type CanonicalStageResult = {
  status: "SUCCEEDED" | "FAILED" | "WAITING";
  evidence: readonly string[];
  safeCode?: string;
};

export type CanonicalPipelineResult = {
  schemaVersion: "1.0";
  status: "SUCCEEDED" | "FAILED";
  evidenceScope: "local-controlled-conformance-only" | "production-like";
  productionLikeAcceptanceClaimed: boolean;
  fixtureSetId: string;
  dataClassification: string;
  adapter: { path: string; available: true; callable: true };
  stages: Record<CanonicalStageId, CanonicalStageResult>;
  cleanup: { attempted: boolean; complete: boolean; tombstone?: string };
};
