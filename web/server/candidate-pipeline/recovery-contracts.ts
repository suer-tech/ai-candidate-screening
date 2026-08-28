export const COVERAGE_FIRST_WORKFLOW_VERSION = "matrix-v3" as const;

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

export function recoveryArtifactSchema(workflowVersion: string, toolKey: string): string | undefined {
  return workflowVersion === COVERAGE_FIRST_WORKFLOW_VERSION ? MATRIX_V3_ARTIFACT_SCHEMAS[toolKey] : undefined;
}

export function recoveryArtifactPurpose(workflowVersion: string): string {
  return `candidate-pipeline-stage:${workflowVersion}`;
}
