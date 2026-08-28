import { randomUUID } from "node:crypto";
import type { PostgresClient } from "../storage/postgres.ts";
import { withTransaction } from "../storage/postgres.ts";
import type { CandidateMatrixRow, CandidateSourceClaim, VacancyMatrix } from "./matrix-driven.ts";
import { COVERAGE_FIRST_WORKFLOW_VERSION } from "./recovery-contracts.ts";

export class PostgresVacancyMatrixRepository {
  constructor(private readonly sql: PostgresClient, private readonly defaultWorkflowIdentity: string = COVERAGE_FIRST_WORKFLOW_VERSION) {}

  async claimCompilation(input: { profileVersion: string; workflowIdentity?: string; ownerId: string; now: Date; leaseMs: number; allowRetry?: boolean }) {
    const workflowIdentity = input.workflowIdentity ?? this.defaultWorkflowIdentity;
    return withTransaction(this.sql, async (transaction) => {
      const rows = await transaction<{ state: string; owner_id: string; fencing_token: number; lease_expires_at_utc: Date | string; matrix_id: string | null; attempt: number; terminal_error_code: string | null }[]>`
        SELECT state,owner_id,fencing_token,lease_expires_at_utc,matrix_id,attempt,terminal_error_code
        FROM vacancy_matrix_compilations WHERE profile_version=${input.profileVersion} AND workflow_identity=${workflowIdentity} FOR UPDATE`;
      const current = rows[0];
      if (current?.state === "PUBLISHED" && current.matrix_id) return { owner: false, waiting: false, fencingToken: current.fencing_token, matrixId: current.matrix_id };
      if (current?.state === "FAILED" && !input.allowRetry) return { owner: false, waiting: false, fencingToken: current.fencing_token, attempt: current.attempt, terminalErrorCode: current.terminal_error_code ?? "MATRIX_COMPILATION_FAILED" };
      const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs).toISOString();
      if (!current) {
        await transaction`INSERT INTO vacancy_matrix_compilations
          (profile_version,workflow_identity,state,owner_id,fencing_token,lease_expires_at_utc,attempt)
          VALUES (${input.profileVersion},${workflowIdentity},'CLAIMED',${input.ownerId},1,${leaseExpiresAt},1)`;
        return { owner: true, waiting: false, fencingToken: 1, attempt: 1, recovered: false };
      }
      if (current.state === "CLAIMED" && new Date(current.lease_expires_at_utc).getTime() > input.now.getTime() && current.owner_id !== input.ownerId) {
        return { owner: false, waiting: true, fencingToken: current.fencing_token, attempt: current.attempt };
      }
      const fencingToken = current.fencing_token + 1;
      const attempt = current.attempt + 1;
      await transaction`UPDATE vacancy_matrix_compilations SET state='CLAIMED',owner_id=${input.ownerId},fencing_token=${fencingToken},
        lease_expires_at_utc=${leaseExpiresAt},attempt=${attempt},repair_cycles=0,llm_calls=0,obstacle_fingerprint=NULL,
        same_fingerprint_retries=0,terminal_error_code=NULL,updated_at_utc=clock_timestamp()
        WHERE profile_version=${input.profileVersion} AND workflow_identity=${workflowIdentity}`;
      return { owner: true, waiting: false, fencingToken, attempt, recovered: true };
    });
  }

  async publishMatrix(input: { ownerId: string; fencingToken: number; workflowIdentity?: string; matrix: VacancyMatrix; modelVersions: Record<string, string>; protectedTraceRefs: string[] }) {
    const workflowIdentity = input.workflowIdentity ?? this.defaultWorkflowIdentity;
    return withTransaction(this.sql, async (transaction) => {
      const rows = await transaction<{ state: string; owner_id: string; fencing_token: number; matrix_id: string | null }[]>`
        SELECT state,owner_id,fencing_token,matrix_id FROM vacancy_matrix_compilations
        WHERE profile_version=${input.matrix.profileVersion} AND workflow_identity=${workflowIdentity} FOR UPDATE`;
      const current = rows[0];
      if (!current || current.owner_id !== input.ownerId || current.fencing_token !== input.fencingToken) throw new Error("MATRIX_STALE_FENCING_TOKEN");
      if (current.state === "PUBLISHED" && current.matrix_id) {
        const existing = await transaction<{ checksum: string }[]>`SELECT checksum FROM vacancy_matrices WHERE id=${current.matrix_id}`;
        if (existing[0]?.checksum !== input.matrix.checksum) throw new Error("MATRIX_ALREADY_PUBLISHED");
        return { matrixId: current.matrix_id, checksum: existing[0].checksum, reused: true };
      }
      const matrixId = `matrix-${workflowIdentity.replace(/[^a-zA-Z0-9-]/g, "-")}-${input.matrix.checksum.slice(0, 24)}`;
      await transaction`INSERT INTO vacancy_matrices
        (profile_version,workflow_identity,id,schema_version,compiler_policy_version,skill_versions_json,model_versions_json,protected_trace_refs_json,payload_json,checksum)
        VALUES (${input.matrix.profileVersion},${workflowIdentity},${matrixId},${input.matrix.schemaVersion},${input.matrix.compilerPolicyVersion},
          ${JSON.stringify(input.matrix.skillVersions)},${JSON.stringify(input.modelVersions)},${JSON.stringify(input.protectedTraceRefs)},${JSON.stringify(input.matrix)},${input.matrix.checksum})`;
      await transaction`UPDATE vacancy_matrix_compilations SET state='PUBLISHED',matrix_id=${matrixId},updated_at_utc=clock_timestamp()
        WHERE profile_version=${input.matrix.profileVersion} AND workflow_identity=${workflowIdentity}`;
      return { matrixId, checksum: input.matrix.checksum, reused: false };
    });
  }

  async recordCompilationProgress(input: { profileVersion: string; workflowIdentity?: string; ownerId: string; fencingToken: number; repairCycles: number; llmCalls: number; obstacleFingerprint?: string; sameFingerprintRetries?: number }) {
    const workflowIdentity = input.workflowIdentity ?? this.defaultWorkflowIdentity;
    const result = await this.sql`UPDATE vacancy_matrix_compilations SET repair_cycles=${input.repairCycles},llm_calls=${input.llmCalls},
      obstacle_fingerprint=${input.obstacleFingerprint ?? null},same_fingerprint_retries=${input.sameFingerprintRetries ?? 0},updated_at_utc=clock_timestamp()
      WHERE profile_version=${input.profileVersion} AND workflow_identity=${workflowIdentity} AND owner_id=${input.ownerId} AND fencing_token=${input.fencingToken} AND state='CLAIMED'`;
    if (Number(result.count) !== 1) throw new Error("MATRIX_STALE_FENCING_TOKEN");
  }

  async failCompilation(input: { profileVersion: string; workflowIdentity?: string; ownerId: string; fencingToken: number; errorCode: string }) {
    const workflowIdentity = input.workflowIdentity ?? this.defaultWorkflowIdentity;
    const result = await this.sql`UPDATE vacancy_matrix_compilations SET state='FAILED',terminal_error_code=${input.errorCode},updated_at_utc=clock_timestamp()
      WHERE profile_version=${input.profileVersion} AND workflow_identity=${workflowIdentity} AND owner_id=${input.ownerId} AND fencing_token=${input.fencingToken} AND state='CLAIMED'`;
    if (Number(result.count) !== 1) throw new Error("MATRIX_STALE_FENCING_TOKEN");
  }

  async readMatrix(profileVersion: string, workflowIdentity = this.defaultWorkflowIdentity) {
    const rows = await this.sql<{ id: string; payload_json: string; checksum: string }[]>`SELECT id,payload_json,checksum FROM vacancy_matrices WHERE profile_version=${profileVersion} AND workflow_identity=${workflowIdentity}`;
    return rows[0] ? { matrixId: rows[0].id, matrix: JSON.parse(rows[0].payload_json) as VacancyMatrix, checksum: rows[0].checksum } : null;
  }

  async appendClaim(input: { candidateId: number; claim: CandidateSourceClaim }) {
    await this.sql`INSERT INTO candidate_source_claims
      (id,candidate_id,run_id,input_version_id,profile_version,author,role,role_confidence,source_class,directness,claim_text,locator_json,criterion_ids_json,provenance_ref)
      VALUES (${input.claim.claimId},${input.candidateId},${input.claim.runId},${input.claim.inputVersion},${input.claim.profileVersion},
        ${input.claim.author},${input.claim.role},${input.claim.roleConfidence ?? null},${input.claim.sourceClass},${input.claim.directness},${input.claim.text},
        ${JSON.stringify({ locator: input.claim.locator })},${JSON.stringify(input.claim.criterionIds)},${input.claim.provenanceRef})`;
  }

  async appendConflict(input: { candidateId: number; runId: string; inputVersion: string; profileVersion: string; predicate: string; claimIds: string[]; followUpQuestion: string; provenanceRef: string }) {
    const id = `conflict-${randomUUID()}`;
    await this.sql`INSERT INTO candidate_evidence_conflicts
      (id,candidate_id,run_id,input_version_id,profile_version,predicate,claim_ids_json,follow_up_question,provenance_ref)
      VALUES (${id},${input.candidateId},${input.runId},${input.inputVersion},${input.profileVersion},${input.predicate},${JSON.stringify(input.claimIds)},${input.followUpQuestion},${input.provenanceRef})`;
    return id;
  }

  async appendRow(input: { candidateId: number; runId: string; inputVersion: string; profileVersion: string; matrixId: string; row: CandidateMatrixRow; verificationTraceRef?: string }) {
    const id = `matrix-row-${randomUUID()}`;
    await this.sql`INSERT INTO candidate_matrix_rows
      (id,matrix_id,candidate_id,run_id,input_version_id,profile_version,criterion_id,state,supporting_claim_ids_json,contradicting_claim_ids_json,
       checked_source_ids_json,reason,missing_data,follow_up_question,verification_state,verification_trace_ref)
      VALUES (${id},${input.matrixId},${input.candidateId},${input.runId},${input.inputVersion},${input.profileVersion},${input.row.criterionId},${input.row.state},
        ${JSON.stringify(input.row.supportingClaimIds)},${JSON.stringify(input.row.contradictingClaimIds)},${JSON.stringify(input.row.checkedSourceIds)},${input.row.reason},
        ${input.row.missingData},${input.row.followUpQuestion},${input.row.verificationState},${input.verificationTraceRef ?? null})`;
    return id;
  }
}
