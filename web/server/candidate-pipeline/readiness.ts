export const CANDIDATE_PIPELINE_RUNTIME_CONTRACT = "durable-agent-runtime/v1";
export type CandidatePipelineRoutingMode = "disabled" | "shadow" | "effectful";

export type CandidatePipelineEnvironment = {
  DB?: unknown;
  CANDIDATE_PIPELINE_ROUTING?: string;
  CANDIDATE_PIPELINE_BUILD_ID?: string;
  CANDIDATE_PIPELINE_RELEASE_EVIDENCE_JSON?: string;
  AGENT_RUNTIME_INTERNAL_TOKEN?: string;
  AGENT_RUNTIME_CONFIG_JSON?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_OAUTH_REDIRECT_URI?: string;
  GOOGLE_OAUTH_DEPLOYMENT_MODE?: string;
  GOOGLE_OAUTH_TOKEN_KEYRING_JSON?: string;
  LLM_RUNTIME_CONFIG_JSON?: string;
  ROUTERAI_API_KEY?: string;
  ROUTERAI_CONTEXT_WINDOW_TOKENS?: string;
  MATRIX_BATCH_SAFETY_TOKENS?: string;
  ASSEMBLYAI_API_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_RECIPIENT_REFS_JSON?: string;
  MEDIA_PROCESSOR_URL?: string;
  MEDIA_PROCESSOR_TOKEN?: string;
  DOCUMENT_PROCESSOR_URL?: string;
  DOCUMENT_PROCESSOR_TOKEN?: string;
  PROTECTED_LLM_TRACES?: unknown;
};

const baseRequirements: Array<keyof CandidatePipelineEnvironment> = [
  "AGENT_RUNTIME_INTERNAL_TOKEN",
  "AGENT_RUNTIME_CONFIG_JSON",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REDIRECT_URI",
  "GOOGLE_OAUTH_DEPLOYMENT_MODE",
  "GOOGLE_OAUTH_TOKEN_KEYRING_JSON",
  "LLM_RUNTIME_CONFIG_JSON",
  "ROUTERAI_API_KEY",
  "ASSEMBLYAI_API_KEY",
];

export function candidatePipelineReadiness(environment: CandidatePipelineEnvironment) {
  const mode = environment.CANDIDATE_PIPELINE_ROUTING as CandidatePipelineRoutingMode | undefined;
  if (!mode || mode === "disabled") return { ready: false as const, mode: "disabled" as const, missing: [] as Array<keyof CandidatePipelineEnvironment>, reason: "ROUTING_DISABLED", runtimeContract: CANDIDATE_PIPELINE_RUNTIME_CONTRACT };
  if (mode !== "shadow" && mode !== "effectful") return { ready: false as const, mode: "disabled" as const, missing: [] as Array<keyof CandidatePipelineEnvironment>, reason: "INVALID_ROUTING_MODE", runtimeContract: CANDIDATE_PIPELINE_RUNTIME_CONTRACT };
  const supplied = environment as unknown as Record<string, unknown>;
  if ([supplied.GOOGLE_SHARED_DRIVE_ID, supplied.GOOGLE_SHARED_DRIVE_ROOT_FOLDER_ID, supplied.GOOGLE_SERVICE_ACCOUNT_JSON]
    .some((value) => typeof value === "string" && value.trim())) {
    return { ready: false as const, mode, missing: [] as Array<keyof CandidatePipelineEnvironment>, reason: "GOOGLE_DRIVE_BACKEND_UNSUPPORTED", runtimeContract: CANDIDATE_PIPELINE_RUNTIME_CONTRACT };
  }
  const required = mode === "effectful" ? [...baseRequirements, "TELEGRAM_BOT_TOKEN", "TELEGRAM_RECIPIENT_REFS_JSON"] as Array<keyof CandidatePipelineEnvironment> : baseRequirements;
  const missing = required.filter((key) => environment[key] === undefined || environment[key] === "");
  if (missing.length) return { ready: false as const, mode, missing, reason: "MISSING_RUNTIME_BINDINGS", runtimeContract: CANDIDATE_PIPELINE_RUNTIME_CONTRACT };
  if (mode === "effectful") {
    try {
      const evidence = JSON.parse(String(environment.CANDIDATE_PIPELINE_RELEASE_EVIDENCE_JSON ?? "")) as Record<string, unknown>;
      if (!environment.CANDIDATE_PIPELINE_BUILD_ID || evidence.buildId !== environment.CANDIDATE_PIPELINE_BUILD_ID || typeof evidence.configurationFingerprint !== "string" || !evidence.configurationFingerprint || evidence.pairRecoveryGreen !== true || evidence.outboxRecoveryGreen !== true || evidence.hardBudgetsVerified !== true) throw new Error("invalid");
    } catch { return { ready: false as const, mode, missing: [] as Array<keyof CandidatePipelineEnvironment>, reason: "RELEASE_EVIDENCE_INVALID", runtimeContract: CANDIDATE_PIPELINE_RUNTIME_CONTRACT }; }
  }
  return { ready: true as const, mode, missing: [] as Array<keyof CandidatePipelineEnvironment>, reason: "READY", runtimeContract: CANDIDATE_PIPELINE_RUNTIME_CONTRACT };
}
