import { canonicalizeVacancyMatrix, type MatrixCriterionDraft, type VacancyMatrix } from "./matrix-driven.ts";

export const MATRIX_COMPILATION_LIMITS = Object.freeze({
  llmCalls: 2,
  providerCallTimeoutMs: 600_000,
  elapsedMetricMs: 1_800_000,
});

export type MatrixCriticViolation = {
  violationId: string;
  severity: "error" | "warning";
  sourceRefs: string[];
  expectedChange: string;
};

export type MatrixDraftEnvelope = {
  schemaVersion: "vacancy-matrix-draft/v1";
  criteria: MatrixCriterionDraft[];
  traceRef: string;
  model: string;
};

export type MatrixCriticEnvelope = {
  schemaVersion: "vacancy-matrix-critic/v2";
  decision: "PASS" | "CORRECTED";
  changes: Array<{ changeId: string; sourceRefs: string[]; summary: string }>;
  successor: Pick<MatrixDraftEnvelope, "schemaVersion" | "criteria">;
  traceRef: string;
  model: string;
};

export interface MatrixCompilationStore {
  claimCompilation(input: { profileVersion: string; ownerId: string; now: Date; leaseMs: number; allowRetry?: boolean }): Promise<{
    owner: boolean; waiting: boolean; fencingToken: number; matrixId?: string; attempt?: number; terminalErrorCode?: string;
  }>;
  readMatrix(profileVersion: string): Promise<{ matrixId: string; matrix: VacancyMatrix; checksum: string } | null>;
  recordCompilationProgress(input: { profileVersion: string; ownerId: string; fencingToken: number; repairCycles: number; llmCalls: number; obstacleFingerprint?: string; sameFingerprintRetries?: number }): Promise<void>;
  publishMatrix(input: { ownerId: string; fencingToken: number; matrix: VacancyMatrix; modelVersions: Record<string, string>; protectedTraceRefs: string[] }): Promise<{ matrixId: string; checksum: string; reused: boolean }>;
  failCompilation(input: { profileVersion: string; ownerId: string; fencingToken: number; errorCode: string }): Promise<void>;
}

export interface MatrixCompilationSkills {
  compile(input: { profileVersion: string; canonicalProfile: Record<string, unknown>; sourceFragments: Record<string, string> }): Promise<MatrixDraftEnvelope>;
  critique(input: { profileVersion: string; canonicalProfile: Record<string, unknown>; sourceFragments: Record<string, string>; draft: MatrixDraftEnvelope; policy: Record<string, unknown> }): Promise<MatrixCriticEnvelope>;
}

export type MatrixCompilationResult =
  | { state: "PUBLISHED" | "REUSED"; matrixId: string; matrix: VacancyMatrix; checksum: string; llmCalls: number; repairCycles: number; elapsedMetricExceeded: boolean; sameModelCritic: boolean }
  | { state: "WAITING"; profileVersion: string }
  | { state: "FAILED"; errorCode: string };

function safeCode(error: unknown) {
  const message = error instanceof Error ? error.message : "MATRIX_COMPILATION_FAILED";
  return /^[A-Z][A-Z0-9_.:-]*$/.test(message) ? message : "MATRIX_COMPILATION_FAILED";
}

export async function compileVacancyMatrix(input: {
  profileVersion: string;
  ownerId: string;
  canonicalProfile: Record<string, unknown>;
  sourceFragments: Record<string, string>;
  compilerPolicyVersion: string;
  skills: MatrixCompilationSkills;
  store: MatrixCompilationStore;
  now?: () => Date;
  leaseMs?: number;
  allowRetry?: boolean;
}): Promise<MatrixCompilationResult> {
  const now = input.now ?? (() => new Date());
  const startedAt = now().getTime();
  const existing = await input.store.readMatrix(input.profileVersion);
  if (existing) return { state: "REUSED", ...existing, llmCalls: 0, repairCycles: 0, elapsedMetricExceeded: false, sameModelCritic: false };
  const claim = await input.store.claimCompilation({ profileVersion: input.profileVersion, ownerId: input.ownerId, now: now(), leaseMs: input.leaseMs ?? 660_000, allowRetry: input.allowRetry });
  if (!claim.owner) {
    const published = await input.store.readMatrix(input.profileVersion);
    return published
      ? { state: "REUSED", ...published, llmCalls: 0, repairCycles: 0, elapsedMetricExceeded: false, sameModelCritic: false }
      : claim.terminalErrorCode ? { state: "FAILED", errorCode: claim.terminalErrorCode }
      : { state: "WAITING", profileVersion: input.profileVersion };
  }
  let llmCalls = 0;
  const repairCycles = 0;
  const traces: string[] = [];
  const models: Record<string, string> = {};
  try {
    const draft = await input.skills.compile({ profileVersion: input.profileVersion, canonicalProfile: structuredClone(input.canonicalProfile), sourceFragments: structuredClone(input.sourceFragments) });
    llmCalls += 1; traces.push(draft.traceRef); models.compiler = draft.model;
    const critic = await input.skills.critique({
      profileVersion: input.profileVersion,
      canonicalProfile: structuredClone(input.canonicalProfile),
      sourceFragments: structuredClone(input.sourceFragments),
      draft: structuredClone(draft),
      policy: { compilerPolicyVersion: input.compilerPolicyVersion, singlePassEditor: true },
    });
    llmCalls += 1; traces.push(critic.traceRef); models.critic = critic.model;
    const canonicalize = (criteria: MatrixCriterionDraft[]) => canonicalizeVacancyMatrix({
      profileVersion: input.profileVersion,
      compilerPolicyVersion: input.compilerPolicyVersion,
      skillVersions: { compiler: "compile-vacancy-matrix/v1", critic: "critique-vacancy-matrix/v2" },
      modelVersions: models,
      sourceFragments: input.sourceFragments,
      criteria,
    });
    let matrix: VacancyMatrix;
    try {
      matrix = canonicalize(critic.successor.criteria);
    } catch {
      matrix = canonicalize(draft.criteria);
    }
    const published = await input.store.publishMatrix({ ownerId: input.ownerId, fencingToken: claim.fencingToken, matrix, modelVersions: models, protectedTraceRefs: traces });
    return { state: published.reused ? "REUSED" : "PUBLISHED", ...published, matrix, llmCalls, repairCycles,
      elapsedMetricExceeded: now().getTime() - startedAt > MATRIX_COMPILATION_LIMITS.elapsedMetricMs,
      sameModelCritic: models.compiler === models.critic };
  } catch (error) {
    const errorCode = safeCode(error);
    await input.store.failCompilation({ profileVersion: input.profileVersion, ownerId: input.ownerId, fencingToken: claim.fencingToken, errorCode });
    return { state: "FAILED", errorCode };
  }
}
