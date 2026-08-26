import type { CandidatePipelineEnvironment, CandidatePipelineRoutingMode } from "./readiness.ts";
import { candidatePipelineReadiness } from "./readiness.ts";

export type CandidatePipelineEffect = "drive-read" | "provider-processing" | "artifact-write" | "drive-publication" | "telegram-delivery";

export function authorizePipelineEffect(environment: CandidatePipelineEnvironment, effect: CandidatePipelineEffect) {
  const readiness = candidatePipelineReadiness(environment);
  if (!readiness.ready) return { allowed: false as const, mode: readiness.mode, reason: readiness.reason };
  const mode = environment.CANDIDATE_PIPELINE_ROUTING as CandidatePipelineRoutingMode;
  if (mode === "shadow" && (effect === "drive-publication" || effect === "telegram-delivery")) return { allowed: false as const, mode, reason: "SHADOW_VISIBLE_EFFECT_DENIED" };
  return { allowed: true as const, mode, reason: "AUTHORIZED" };
}
