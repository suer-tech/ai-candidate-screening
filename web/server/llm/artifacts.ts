import { artifactHash, deepFreeze, type JsonValue } from "./value-utils.ts";

export interface PromptArtifact {
  readonly id: string;
  readonly version: string;
  readonly template: string;
  readonly hash: string;
}

export interface SchemaArtifact {
  readonly id: string;
  readonly version: string;
  readonly schema: Readonly<JsonValue>;
  readonly hash: string;
}

function prompt(id: string, version: string, template: string): PromptArtifact {
  return deepFreeze({ id, version, template, hash: artifactHash(template) });
}

function schema(id: string, version: string, value: JsonValue): SchemaArtifact {
  return deepFreeze({ id, version, schema: value, hash: artifactHash(value) });
}

export const PROMPT_ARTIFACTS = deepFreeze({
  "vacancy-profile/v1": prompt(
    "vacancy-profile",
    "v1",
    "Produce a structured vacancy profile from the supplied approved business input. Return only the configured response schema.",
  ),
  "document-ocr/v1": prompt(
    "document-ocr",
    "v1",
    "Extract text and source locators from the supplied document snapshot without inventing missing content.",
  ),
  "speaker-mapping/v1": prompt(
    "speaker-mapping",
    "v1",
    "Map transcript speaker labels to roles using only evidence in the supplied transcript snapshot.",
  ),
  "candidate-assessment/v1": prompt(
    "candidate-assessment",
    "v1",
    "Assess the supplied candidate evidence against the supplied versioned vacancy profile and return the configured evidence schema.",
  ),
  "result-validation/v1": prompt(
    "result-validation",
    "v1",
    "Validate or repair the supplied structured result against the configured schema without adding unsupported evidence.",
  ),
  "agent-subcall/v1": prompt(
    "agent-subcall",
    "v1",
    "Perform the explicitly supplied bounded agent task using only the configured tools and response schema.",
  ),
} satisfies Record<string, PromptArtifact>);

const structuredObjectSchema: JsonValue = {
  type: "object",
  additionalProperties: true,
};

export const RESPONSE_SCHEMA_ARTIFACTS = deepFreeze({
  "structured-object/v1": schema("structured-object", "v1", structuredObjectSchema),
} satisfies Record<string, SchemaArtifact>);

export const TOOL_SCHEMA_ARTIFACTS = deepFreeze({
  "no-tools/v1": schema("no-tools", "v1", { type: "array", maxItems: 0 }),
} satisfies Record<string, SchemaArtifact>);

export const SAFE_EXECUTION_DEFAULTS = deepFreeze({
  id: "llm-execution-defaults",
  version: "v1",
  generationParameters: { temperature: 0 } satisfies JsonValue,
  limits: { maxInputBytes: 10_000_000, maxOutputTokens: 8_192 } satisfies JsonValue,
  timeoutMs: 120_000,
  retryPolicy: {
    maxAttempts: 1,
    initialBackoffMs: 0,
    maximumBackoffMs: 0,
  },
  hash: artifactHash({
    generationParameters: { temperature: 0 },
    limits: { maxInputBytes: 10_000_000, maxOutputTokens: 8_192 },
    timeoutMs: 120_000,
    retryPolicy: { maxAttempts: 1, initialBackoffMs: 0, maximumBackoffMs: 0 },
  }),
});
