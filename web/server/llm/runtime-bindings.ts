import { env } from "cloudflare:workers";
import { AdminOnlyProtectedTraceStore } from "./protected-store.ts";
import { R2ProtectedTracePersistence } from "./r2-persistence.ts";
import { loadRuntimeConfiguration } from "./runtime-loader.ts";
import type { LogicalLlmCapability } from "./configuration.ts";

export function protectedTraceStore() {
  if (!env.PROTECTED_LLM_TRACES) throw new Error("Protected trace binding PROTECTED_LLM_TRACES is unavailable");
  return new AdminOnlyProtectedTraceStore(new R2ProtectedTracePersistence(env.PROTECTED_LLM_TRACES));
}

export function llmRuntimeConfiguration(requiredCapabilities: readonly LogicalLlmCapability[]) {
  return loadRuntimeConfiguration(env, requiredCapabilities);
}
