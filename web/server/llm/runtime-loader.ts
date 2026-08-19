import {
  validateRuntimeConfiguration,
  type LogicalLlmCapability,
  type RuntimeConfigDocument,
  type RuntimeSecretSource,
} from "./configuration.ts";

export interface LlmRuntimeEnvironment {
  LLM_RUNTIME_CONFIG_JSON?: string;
  [key: string]: unknown;
}

export function loadRuntimeConfiguration(environment: LlmRuntimeEnvironment, requiredCapabilities: readonly LogicalLlmCapability[]) {
  const raw = environment.LLM_RUNTIME_CONFIG_JSON?.trim();
  if (!raw) throw new Error("LLM_RUNTIME_CONFIG_JSON is required");
  let document: RuntimeConfigDocument;
  try {
    document = JSON.parse(raw) as RuntimeConfigDocument;
  } catch {
    throw new Error("LLM_RUNTIME_CONFIG_JSON must be valid JSON");
  }
  const secrets: RuntimeSecretSource = {
    has(reference) {
      return typeof environment[reference] === "string" && String(environment[reference]).trim() !== "";
    },
    read(reference) {
      const value = environment[reference];
      return typeof value === "string" ? value : undefined;
    },
  };
  return validateRuntimeConfiguration(document, secrets, { requiredCapabilities });
}
