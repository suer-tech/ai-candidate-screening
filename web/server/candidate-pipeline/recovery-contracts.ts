export const COVERAGE_FIRST_WORKFLOW_VERSION = "matrix-v3" as const;
export const RABBIT_PARALLEL_WORKFLOW_VERSION = "matrix-v4-rabbit-parallel" as const;

const MATRIX_V3_ARTIFACT_SCHEMAS: Readonly<Record<string, string>> = Object.freeze({
  "candidate.drive-snapshot/v1": "drive-snapshot/v1",
  "candidate.matrix-compile/v1": "vacancy-matrix/v3",
  "candidate.document-extraction/v1": "document-bundle/v1",
  "candidate.transcription/v1": "transcript-bundle/v1",
  "candidate.matrix-context-search/v1": "matrix-context-index/v1",
  "candidate.matrix-context-read/v1": "matrix-decision-safe-context/v1",
  "candidate.matrix-claim-submit/v1": "matrix-claims-bundle/v2",
  "candidate.matrix-conflict-submit/v1": "matrix-evidence/v2",
  "candidate.matrix-rows/v1": "candidate-matrix-rows-bundle/v3",
  "candidate.matrix-verify/v1": "matrix-verification/v2",
  "candidate.matrix-recommendation/v1": "matrix-assessment-snapshot/v2",
  "candidate.validation/v1": "validated-matrix-assessment/v2",
  "candidate.report/v1": "candidate-report/v1",
  "candidate.drive-publication/v1": "published-candidate-report/v1",
  "candidate.telegram/v1": "notification-outcome/v1",
});

const MATRIX_V4_PARALLEL_ARTIFACT_SCHEMAS: Readonly<Record<string, string>> = Object.freeze({
  ...MATRIX_V3_ARTIFACT_SCHEMAS,
  "candidate.document-shard/v1": "document-bundle/v1",
  "candidate.transcript-shard/v1": "transcript-bundle/v1",
  "candidate.transcript-normalize-shard/v1": "transcript-bundle/v1",
  "candidate.transcript-media-shard/v1": "transcript-audio/v1",
  "candidate.transcript-submit-shard/v1": "transcript-provider-job/v1",
  "candidate.transcript-collect-shard/v1": "transcript-bundle/v1",
  "candidate.evidence-shard/v1": "matrix-evidence-shard/v1",
  "candidate.row-shard/v1": "matrix-row-shard/v1",
  "candidate.abc-shard/v1": "matrix-abc-shard/v1",
  "candidate.critical-shard/v1": "matrix-critical-shard/v1",
  "candidate.document-join/v1": "document-bundle/v1",
  "candidate.transcript-join/v1": "transcript-bundle/v1",
  "candidate.evidence-join/v1": "matrix-claims-bundle/v2",
  "candidate.rows-join/v1": "candidate-matrix-rows-bundle/v3",
  "candidate.abc-join/v1": "candidate-abc-directions/v1",
  "candidate.assessment-join/v1": "candidate-matrix-rows-bundle/v3",
  "candidate.critical-join/v1": "matrix-verification/v2",
});

export function recoveryArtifactSchema(workflowVersion: string, toolKey: string): string | undefined {
  if (workflowVersion === COVERAGE_FIRST_WORKFLOW_VERSION) return MATRIX_V3_ARTIFACT_SCHEMAS[toolKey];
  if (workflowVersion === RABBIT_PARALLEL_WORKFLOW_VERSION) return MATRIX_V4_PARALLEL_ARTIFACT_SCHEMAS[toolKey];
  return undefined;
}

export function recoveryArtifactPurpose(workflowVersion: string): string {
  return `candidate-pipeline-stage:${workflowVersion}`;
}
