import type { EffectiveCapabilityConfig } from "../llm/configuration.ts";
import { countOpenAiCompatibleContextTokens } from "../llm/token-counting.ts";
import type { JsonValue } from "../llm/value-utils.ts";

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error("MATRIX_OUTPUT_BUDGET_INVALID");
  return Number(value);
}

export function matrixCompilationCapabilityConfig(config: Readonly<EffectiveCapabilityConfig>, input: {
  compilationAttempt: number; contextWindowTokens: number; safetyTokens: number; userContent: JsonValue;
}): Readonly<EffectiveCapabilityConfig> {
  if (config.capability !== "matrix_compiler" && config.capability !== "matrix_critic") return config;
  const attempt = positiveInteger(input.compilationAttempt);
  const contextWindow = positiveInteger(input.contextWindowTokens);
  const safetyTokens = positiveInteger(input.safetyTokens);
  if (!config.generationParameters || typeof config.generationParameters !== "object" || Array.isArray(config.generationParameters)
    || !config.limits || typeof config.limits !== "object" || Array.isArray(config.limits)) throw new Error("MATRIX_OUTPUT_BUDGET_INVALID");
  const generation = config.generationParameters;
  const explicit = ["max_tokens", "max_completion_tokens"].filter((key) => Object.hasOwn(generation, key));
  if (explicit.length > 1) throw new Error("MATRIX_OUTPUT_TOKEN_LIMIT_AMBIGUOUS");
  const base = positiveInteger(explicit.length ? generation[explicit[0]] : config.limits.maxOutputTokens);
  // Shared compilation claims count actual calls; deferred candidate deliveries do not.
  const desired = Math.min(base * 2 ** Math.min(attempt - 1, 2), Math.max(base, 32_768));
  const withBudget = (maxOutputTokens: number): Readonly<EffectiveCapabilityConfig> => Object.freeze({
    ...config,
    generationParameters: Object.freeze({ ...generation, ...(explicit.length ? { [explicit[0]]: maxOutputTokens } : {}) }),
    limits: Object.freeze({ ...config.limits as Record<string, JsonValue>, maxOutputTokens }),
  });
  const requested = withBudget(desired);
  const required = countOpenAiCompatibleContextTokens({ config: requested, userContent: input.userContent, safetyTokens });
  const available = desired - Math.max(0, required - contextWindow);
  if (available < base) {
    // An explicit limit is part of the serialized request and can change its token count.
    const baseline = withBudget(base);
    if (countOpenAiCompatibleContextTokens({ config: baseline, userContent: input.userContent, safetyTokens }) <= contextWindow) return baseline;
    throw new Error("MATRIX_CONTEXT_BUDGET_EXCEEDED");
  }
  const bounded = withBudget(available);
  if (countOpenAiCompatibleContextTokens({ config: bounded, userContent: input.userContent, safetyTokens }) > contextWindow) {
    throw new Error("MATRIX_CONTEXT_BUDGET_EXCEEDED");
  }
  return bounded;
}
