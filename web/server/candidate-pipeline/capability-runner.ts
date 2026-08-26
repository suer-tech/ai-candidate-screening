import { executeLlmAttempt, LlmProviderAttemptError, type ExecuteLlmAttemptDependencies, type ExecuteLlmAttemptInput, type ExecuteLlmAttemptResult } from "../llm/gateway.ts";
import type { BudgetUsage } from "../agent-runtime/types.ts";

export interface CapabilityBudget {
  reserve(amount: Partial<BudgetUsage>): void | Promise<void>;
  commit(amount: Partial<BudgetUsage>): void | Promise<void>;
  release(amount: Partial<BudgetUsage>): void | Promise<void>;
}

export type CapabilityRunnerResult = ExecuteLlmAttemptResult & { attempts: number };

export async function runLlmCapabilityWithPolicy(dependencies: ExecuteLlmAttemptDependencies, budget: CapabilityBudget, input: ExecuteLlmAttemptInput): Promise<CapabilityRunnerResult> {
  const config = dependencies.configuration.resolve(input.capability, input.explicitFallbackIndex === undefined ? undefined : { explicitFallbackIndex: input.explicitFallbackIndex });
  let lastError: unknown;
  for (let attempt = 1; attempt <= config.retryPolicy.maxAttempts; attempt += 1) {
    const reservation = { llmCalls: 1, externalRequests: 1 } as const;
    await budget.reserve(reservation);
    try {
      const result = await executeLlmAttempt(dependencies, { ...input, correlation: {
        ...input.correlation,
        traceId: `${input.correlation.traceId}:attempt:${attempt}`,
        attemptNumber: attempt,
        attemptId: `${input.correlation.attemptId}:retry:${attempt}`,
      } });
      await budget.commit(reservation);
      return { ...result, attempts: attempt };
    } catch (error) {
      await budget.commit(reservation);
      lastError = error;
      const provider = error instanceof LlmProviderAttemptError ? error : null;
      if (!provider?.retryable || attempt >= config.retryPolicy.maxAttempts) throw safeCapabilityError(error);
      const configured = Math.min(config.retryPolicy.maximumBackoffMs, config.retryPolicy.initialBackoffMs * 2 ** (attempt - 1));
      const delay = Math.max(configured, provider.retryBackoffMs ?? 0);
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw safeCapabilityError(lastError);
}

function safeCapabilityError(error: unknown) {
  if (error instanceof LlmProviderAttemptError) {
    const errorClass = error.traceError && typeof error.traceError === "object" && !Array.isArray(error.traceError) && typeof error.traceError.class === "string" ? error.traceError.class : "provider_failure";
    return new Error(`LLM_CAPABILITY_FAILED:${errorClass}`);
  }
  if (error instanceof Error && /^[A-Z][A-Z0-9_.-]*(?::[A-Za-z0-9_.-]+)*$/.test(error.message)) return error;
  return new Error("LLM_CAPABILITY_FAILED:internal");
}
