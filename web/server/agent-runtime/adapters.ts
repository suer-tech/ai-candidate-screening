import type { ToolDefinition } from "./types.ts";

export type ToolCallContext = {
  candidateId: string;
  runId: string;
  inputVersion: string;
  idempotencyIdentity: string;
  signal?: AbortSignal;
};

export type RegisteredToolAdapter<TInput, TOutput> = {
  definition: ToolDefinition;
  invoke(input: TInput, context: ToolCallContext): Promise<TOutput>;
  reconcile?(identity: string): Promise<{ state: "CONFIRMED" | "ABSENT" | "UNKNOWN"; output?: TOutput }>;
  compensate?(identity: string): Promise<void>;
};

export function transcriptionToolAdapter<TInput, TOutput>(run: (input: TInput) => Promise<TOutput>): RegisteredToolAdapter<TInput, TOutput> {
  return {
    definition: {
      key: "transcription.pipeline/v1", version: "1", inputSchemaVersion: "1.0", outputSchemaVersion: "1.0",
      timeoutClass: "assemblyai-long-job", retryClass: "transient", sideEffectClass: "idempotent-write",
      idempotency: "provider-key", checkpoint: "remote-job", requiredSecrets: ["ASSEMBLYAI_API_KEY"], recoveryActions: ["poll-saved-job", "reconcile-upload"],
    },
    invoke: (input) => run(input),
  };
}

export function protectedLlmTraceToolAdapter<TInput, TOutput>(run: (input: TInput) => Promise<TOutput>): RegisteredToolAdapter<TInput, TOutput> {
  return {
    definition: {
      key: "llm.protected-trace/v1", version: "1", inputSchemaVersion: "1.0", outputSchemaVersion: "1.0",
      timeoutClass: "routerai-analysis", retryClass: "transient", sideEffectClass: "idempotent-write",
      idempotency: "identity", checkpoint: "artifact", requiredSecrets: ["ROUTERAI_API_KEY"], recoveryActions: ["reuse-protected-trace", "reconcile-artifact"],
    },
    invoke: (input) => run(input),
  };
}
