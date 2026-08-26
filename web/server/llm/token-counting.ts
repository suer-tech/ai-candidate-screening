import { getEncoding } from "js-tiktoken";
import type { EffectiveCapabilityConfig } from "./configuration.ts";
import { structuredResponseFormat } from "./gateway.ts";
import type { JsonValue } from "./value-utils.ts";

const o200k = getEncoding("o200k_base");

function messageForTransport(message: JsonValue): JsonValue {
  if (!message || typeof message !== "object" || Array.isArray(message)) return message;
  const content = message.content;
  if (!content || typeof content !== "object" || Array.isArray(content)) return message;
  return { ...message, content: JSON.stringify(content) };
}

function positiveInteger(value: unknown, fallback: number) {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

export function countOpenAiCompatibleContextTokens(input: Readonly<{
  config: Readonly<EffectiveCapabilityConfig>;
  userContent: JsonValue;
  safetyTokens?: number;
}>): number {
  const limits = input.config.limits && typeof input.config.limits === "object" && !Array.isArray(input.config.limits)
    ? input.config.limits as Record<string, JsonValue>
    : {};
  const maxOutputTokens = positiveInteger(limits.maxOutputTokens, 8_192);
  const safetyTokens = positiveInteger(input.safetyTokens, 4_096);
  const body = {
    model: input.config.actualModel,
    messages: [
      { role: "system", content: input.config.prompt.template },
      { role: "user", content: input.userContent },
    ].map((message) => messageForTransport(message as JsonValue)),
    tools: undefined,
    tool_choice: undefined,
    ...input.config.generationParameters as Record<string, JsonValue>,
    response_format: structuredResponseFormat(input.config.responseSchema),
  };
  return o200k.encode(JSON.stringify(body)).length + maxOutputTokens + safetyTokens;
}
