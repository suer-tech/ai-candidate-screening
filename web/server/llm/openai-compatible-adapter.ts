import {
  LlmProviderAttemptError,
  type LlmProviderAdapter,
  type ProviderAttemptRequest,
  type ProviderAttemptResult,
} from "./gateway.ts";
import type { JsonValue } from "./value-utils.ts";

function openAiCompatibleMessages(messages: JsonValue[]): JsonValue[] {
  return messages.map((message) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) return message;
    const content = message.content;
    if (!content || typeof content !== "object" || Array.isArray(content)) return message;
    return { ...message, content: JSON.stringify(content) };
  });
}

function safeError(status: number) {
  if (status === 401 || status === 403) return { class: "authentication" } satisfies JsonValue;
  if (status === 429) return { class: "rate_limit" } satisfies JsonValue;
  if (status >= 500) return { class: "provider_unavailable" } satisfies JsonValue;
  return { class: "provider_request_rejected" } satisfies JsonValue;
}

function protectedResponse(raw: Record<string, unknown>, status: number) {
  const choices = Array.isArray(raw.choices) ? raw.choices : [];
  const first = choices[0] && typeof choices[0] === "object" ? choices[0] as Record<string, unknown> : {};
  const message = first.message && typeof first.message === "object" ? first.message as Record<string, unknown> : {};
  return {
    providerRequestId: typeof raw.id === "string" ? raw.id : undefined,
    reportedModel: typeof raw.model === "string" ? raw.model : undefined,
    providerStatus: status,
    rawEnvelope: raw as JsonValue,
    assistantMessages: Object.keys(message).length ? [message as JsonValue] : [],
    finishReason: typeof first.finish_reason === "string" ? first.finish_reason : undefined,
    usage: raw.usage as JsonValue | undefined,
  };
}

function outputTokenParameter(request: Readonly<ProviderAttemptRequest>) {
  const generation = request.generationParameters && typeof request.generationParameters === "object" && !Array.isArray(request.generationParameters)
    ? request.generationParameters as Record<string, JsonValue>
    : {};
  if (generation.max_tokens !== undefined || generation.max_completion_tokens !== undefined) return {};
  const limits = request.limits && typeof request.limits === "object" && !Array.isArray(request.limits)
    ? request.limits as Record<string, JsonValue>
    : {};
  return Number.isInteger(limits.maxOutputTokens) && Number(limits.maxOutputTokens) > 0
    ? { max_tokens: Number(limits.maxOutputTokens) }
    : {};
}

function balancedJsonValues(text: string) {
  const values: string[] = [];
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{" && text[start] !== "[") continue;
    const stack: string[] = [];
    let quoted = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') { quoted = true; continue; }
      if (character === "{" || character === "[") stack.push(character);
      else if (character === "}" || character === "]") {
        const expected = character === "}" ? "{" : "[";
        if (stack.pop() !== expected) break;
        if (!stack.length) { values.push(text.slice(start, index + 1)); start = index; break; }
      }
    }
  }
  return values;
}

function requiredResponseKeys(responseFormat: JsonValue) {
  if (!responseFormat || typeof responseFormat !== "object" || Array.isArray(responseFormat)) return [];
  const jsonSchema = responseFormat.json_schema;
  if (!jsonSchema || typeof jsonSchema !== "object" || Array.isArray(jsonSchema)) return [];
  const schema = jsonSchema.schema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema) || !Array.isArray(schema.required)) return [];
  return schema.required.filter((value): value is string => typeof value === "string");
}

function hasRequiredResponseKeys(value: JsonValue, responseFormat: JsonValue) {
  const required = requiredResponseKeys(responseFormat);
  return !required.length || Boolean(value && typeof value === "object" && !Array.isArray(value)
    && required.every((key) => Object.prototype.hasOwnProperty.call(value, key)));
}

function matrixValidationCode(output: JsonValue, responseFormat: JsonValue): string | null {
  if (!responseFormat || typeof responseFormat !== "object" || Array.isArray(responseFormat)) return null;
  const envelope = responseFormat.json_schema;
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return null;
  const schema = envelope.schema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema) || !schema.$defs || typeof schema.$defs !== "object" || Array.isArray(schema.$defs)
    || !Object.hasOwn(schema.$defs, "criterion")) return null;
  if (!output || typeof output !== "object" || Array.isArray(output)) return "MATRIX_CRITERIA_INVALID";
  const container = output.successor && typeof output.successor === "object" && !Array.isArray(output.successor) ? output.successor : output;
  if (!container || typeof container !== "object" || Array.isArray(container) || !Array.isArray(container.criteria)) return "MATRIX_CRITERIA_INVALID";
  const criterionSchema = schema.$defs.criterion;
  const refSchema = criterionSchema && typeof criterionSchema === "object" && !Array.isArray(criterionSchema)
    && criterionSchema.properties && typeof criterionSchema.properties === "object" && !Array.isArray(criterionSchema.properties)
    ? criterionSchema.properties.sourceRefs : undefined;
  const allowedRefs = refSchema && typeof refSchema === "object" && !Array.isArray(refSchema)
    && refSchema.items && typeof refSchema.items === "object" && !Array.isArray(refSchema.items)
    && Array.isArray(refSchema.items.enum) ? new Set(refSchema.items.enum) : null;
  const inspect = (nodes: JsonValue[]): string | null => {
    for (const node of nodes) {
      if (!node || typeof node !== "object" || Array.isArray(node)) return "MATRIX_CRITERIA_INVALID";
      if (typeof node.missingDataQuestion !== "string" || !node.missingDataQuestion.trim()) return "MATRIX_MISSING_QUESTION_INVALID";
      if (!Array.isArray(node.sourceRefs) || !node.sourceRefs.length || allowedRefs && node.sourceRefs.some((ref) => !allowedRefs.has(ref))) return "MATRIX_SOURCE_REF_INVALID";
      if (node.children !== undefined && (!Array.isArray(node.children) || inspect(node.children))) return "MATRIX_CHILDREN_INVALID";
    }
    return null;
  };
  return inspect(container.criteria);
}

function parseStructuredContent(content: string, responseFormat: JsonValue): JsonValue {
  const trimmed = content.trim();
  try {
    const parsed = JSON.parse(trimmed) as JsonValue;
    if (hasRequiredResponseKeys(parsed, responseFormat)) return parsed;
  } catch { /* accept a wrapped JSON value below */ }
  const fenced = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)].map((match) => match[1]?.trim()).filter(Boolean) as string[];
  const candidates = [...fenced, ...balancedJsonValues(trimmed)].sort((left, right) => right.length - left.length);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as JsonValue;
      if (hasRequiredResponseKeys(parsed, responseFormat)) return parsed;
    } catch { /* inspect the next complete value */ }
  }
  throw new Error("INVALID_STRUCTURED_CONTENT");
}

export class OpenAiCompatibleProviderAdapter implements LlmProviderAdapter {
  async execute(request: Readonly<ProviderAttemptRequest>): Promise<ProviderAttemptResult> {
    let response: Response;
    try {
      response = await fetch(request.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${request.credential}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: request.model,
          messages: openAiCompatibleMessages(request.messages),
          tools: request.toolDefinitions.length ? request.toolDefinitions : undefined,
          tool_choice: request.toolChoice,
          ...request.generationParameters as Record<string, JsonValue>,
          ...outputTokenParameter(request),
          response_format: request.responseFormat,
        }),
        signal: AbortSignal.timeout(request.timeoutMs),
      });
    } catch (error) {
      const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new LlmProviderAttemptError(timeout ? "provider timeout" : "provider network failure", { class: timeout ? "timeout" : "network" }, undefined, true);
    }
    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      const retryAfter = Number(response.headers.get("retry-after"));
      let protectedFailure: ReturnType<typeof protectedResponse> | undefined;
      try {
        const decoded = await response.json();
        if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) protectedFailure = protectedResponse(decoded as Record<string, unknown>, response.status);
      } catch { /* The safe HTTP status remains usable when the body is unavailable. */ }
      throw new LlmProviderAttemptError("provider request failed", safeError(response.status), response.status, retryable,
        Number.isFinite(retryAfter) ? retryAfter * 1_000 : undefined, protectedFailure);
    }
    let raw: Record<string, unknown>;
    try {
      const decoded = await response.json();
      if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("invalid provider envelope");
      raw = decoded as Record<string, unknown>;
    } catch (error) {
      const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new LlmProviderAttemptError(
        timeout ? "provider response timeout" : "invalid provider response",
        { class: timeout ? "timeout" : "invalid_provider_response" },
        response.status,
        timeout,
      );
    }
    if (raw.error) {
      throw new LlmProviderAttemptError("provider returned an error envelope", { class: "provider_request_rejected" }, response.status, false, undefined, protectedResponse(raw, response.status));
    }
    const choices = Array.isArray(raw.choices) ? raw.choices : [];
    const first = choices[0] && typeof choices[0] === "object" ? choices[0] as Record<string, unknown> : {};
    const message = first.message && typeof first.message === "object" ? first.message as Record<string, unknown> : {};
    const finishReason = typeof first.finish_reason === "string" ? first.finish_reason : undefined;
    if (typeof message.refusal === "string" && message.refusal.trim()) {
      throw new LlmProviderAttemptError("provider refusal", { class: "provider_refusal" }, response.status, false, undefined, protectedResponse(raw, response.status));
    }
    if (finishReason === "length") {
      throw new LlmProviderAttemptError("provider output length exceeded", { class: "output_length_exceeded", finishReason }, response.status, true, undefined, protectedResponse(raw, response.status));
    }
    if (finishReason === "content_filter") {
      throw new LlmProviderAttemptError("provider content filter", { class: "provider_content_filter", finishReason }, response.status, false, undefined, protectedResponse(raw, response.status));
    }
    if (finishReason === "incomplete") {
      throw new LlmProviderAttemptError("incomplete structured response", { class: "incomplete_structured_output", finishReason }, response.status, false, undefined, protectedResponse(raw, response.status));
    }
    const content = message.content;
    let parsedOutput: JsonValue | undefined;
    if (typeof content === "string") {
      try { parsedOutput = parseStructuredContent(content, request.responseFormat); }
      catch { throw new LlmProviderAttemptError("invalid structured response", { class: "invalid_structured_output" }, response.status, false, undefined, protectedResponse(raw, response.status)); }
    } else if (content && typeof content === "object") {
      parsedOutput = content as JsonValue;
    }
    if (parsedOutput === undefined) {
      throw new LlmProviderAttemptError("missing structured response", { class: "missing_structured_output" }, response.status, false, undefined, protectedResponse(raw, response.status));
    }
    const matrixError = matrixValidationCode(parsedOutput, request.responseFormat);
    if (matrixError) {
      throw new LlmProviderAttemptError("invalid matrix structured response", { class: "invalid_structured_output", validationCode: matrixError }, response.status, false, undefined, protectedResponse(raw, response.status));
    }
    const actualSchemaVersion = parsedOutput && typeof parsedOutput === "object" && !Array.isArray(parsedOutput) && typeof parsedOutput.schemaVersion === "string" ? parsedOutput.schemaVersion : undefined;
    return {
      providerRequestId: typeof raw.id === "string" ? raw.id : undefined,
      reportedModel: typeof raw.model === "string" ? raw.model : undefined,
      providerStatus: response.status,
      rawEnvelope: raw as JsonValue,
      assistantMessages: [message as JsonValue],
      finishReason,
      usage: raw.usage as JsonValue | undefined,
      parsedOutput,
      normalizedOutput: parsedOutput,
      actualSchemaVersion,
      toolEvents: [],
    };
  }
}
