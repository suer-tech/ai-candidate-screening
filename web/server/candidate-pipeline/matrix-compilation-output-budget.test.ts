import assert from "node:assert/strict";
import test from "node:test";
import { validateRuntimeConfiguration, type EffectiveCapabilityConfig } from "../llm/configuration.ts";
import { matrixResponseSchemaForProfile } from "../llm/matrix-response-schema.ts";
import { countOpenAiCompatibleContextTokens } from "../llm/token-counting.ts";
import { deepFreeze, type JsonValue } from "../llm/value-utils.ts";
import { matrixCompilationCapabilityConfig } from "./matrix-compilation-output-budget.ts";

type DraftCapability = "matrix_compiler" | "matrix_critic";
const sourceConfiguration = validateRuntimeConfiguration({
  releaseVersion: "synthetic-output-budget-test",
  providers: { controlled: { provider: "synthetic-openai-compatible", endpoint: "https://synthetic.invalid/v1/chat/completions",
    secretReference: "SYNTHETIC_UNUSED_KEY", apiContractVersion: "openai-compatible/v1", supportsStructuredOutputs: true } },
  capabilities: Object.fromEntries(([
    ["matrix_compiler", "compile-vacancy-matrix/v1", "vacancy-matrix-draft/v1"],
    ["matrix_critic", "critique-vacancy-matrix/v2", "vacancy-matrix-critic/v2"],
  ] as const).map(([capability, promptArtifact, responseSchemaArtifact]) => [capability, {
    providerProfile: "controlled", model: "synthetic-model", promptArtifact, responseSchemaArtifact,
    toolSchemaArtifacts: ["no-tools/v1"], generationParameters: {},
    limits: { maxInputBytes: 1_000_000, maxOutputTokens: 8192 }, timeoutMs: 600_000,
    retryPolicy: { maxAttempts: 1, initialBackoffMs: 0, maximumBackoffMs: 0 }, fallbackPolicy: { mode: "disabled" },
  }])),
}, { has: () => true, read: () => "synthetic-unused-value" }, { requiredCapabilities: ["matrix_compiler", "matrix_critic"] });

const userContent = deepFreeze({ profileVersion: "synthetic-profile:v14",
  sourceFragments: { "synthetic-source-one": "Synthetic skill one", "synthetic-source-two": "Synthetic skill two" },
  canonicalProfile: { title: "Synthetic vacancy", requirements: ["Synthetic skill one", "Synthetic skill two"] },
}) as JsonValue;

function fixture(capability: DraftCapability = "matrix_compiler", generationParameters: JsonValue = { temperature: 0 },
  maxOutputTokens: JsonValue = 8192): Readonly<EffectiveCapabilityConfig> {
  const resolved = sourceConfiguration.resolve(capability);
  return deepFreeze({ ...resolved, generationParameters,
    limits: { maxInputBytes: 1_000_000, maxOutputTokens },
    responseSchema: matrixResponseSchemaForProfile(capability, resolved.responseSchema, userContent),
  });
}
function limit(config: Readonly<EffectiveCapabilityConfig>) {
  return (config.limits as Record<string, JsonValue>).maxOutputTokens;
}
function errorCode(expected: string) {
  return (error: unknown) => error instanceof Error && error.message === expected;
}
function input(compilationAttempt: number, extra: Partial<Parameters<typeof matrixCompilationCapabilityConfig>[1]> = {}) {
  return { compilationAttempt, contextWindowTokens: 128_000, safetyTokens: 4096, userContent, ...extra };
}
function contextWithAvailableOutput(config: Readonly<EffectiveCapabilityConfig>, available: number, content: JsonValue = userContent) {
  const calibration = { ...config, limits: { ...(config.limits as Record<string, JsonValue>), maxOutputTokens: 1 } };
  return countOpenAiCompatibleContextTokens({ config: calibration, userContent: content, safetyTokens: 4096 }) - 1 + available;
}

for (const capability of ["matrix_compiler", "matrix_critic"] as const) {
  test(`${capability} grows the output reservation once per shared compilation attempt and caps large attempts`, () => {
    const config = fixture(capability);
    for (const [attempt, expected] of [[1, 8192], [2, 16_384], [3, 32_768], [4, 32_768], [1_000_000_000, 32_768], [Number.MAX_SAFE_INTEGER, 32_768]]) {
      const adjusted = matrixCompilationCapabilityConfig(config, input(attempt));
      assert.equal(limit(adjusted), expected);
      assert.deepEqual(adjusted.responseSchema, config.responseSchema, "the caller's profile-bound schema must remain intact");
      assert.equal(adjusted.timeoutMs, 600_000);
      assert.deepEqual(adjusted.retryPolicy, config.retryPolicy, "larger output must not add provider retries");
    }
    assert.equal(limit(config), 8192);
  });
}

for (const parameter of ["max_tokens", "max_completion_tokens"] as const) {
  test(`${parameter} controls the base and stays aligned with the effective output reservation`, () => {
    const config = fixture("matrix_compiler", { [parameter]: 4096, temperature: 0,
      reasoning: { effort: "low" } }, 8192);
    const before = structuredClone(config);
    const first = matrixCompilationCapabilityConfig(config, input(1));
    const retry = matrixCompilationCapabilityConfig(config, input(2));
    assert.equal(limit(first), 4096, "an explicit generation limit must take precedence over the limits fallback");
    assert.equal(limit(retry), 8192);
    const generation = retry.generationParameters as Record<string, JsonValue>;
    assert.equal(generation[parameter], 8192, "the provider's explicit parameter must use the same effective limit as the trace");
    assert.equal(generation[parameter === "max_tokens" ? "max_completion_tokens" : "max_tokens"], undefined);
    assert.equal(generation.temperature, 0);
    assert.deepEqual(generation.reasoning, { effort: "low" });
    assert.deepEqual(config, before, "a retry must not modify the shared configuration or its nested fields");
  });
}

test("a configured base above 32768 is preserved instead of being reduced to the default cap", () => {
  const config = fixture("matrix_compiler", {}, 49_152);
  for (const attempt of [1, 2, 3, Number.MAX_SAFE_INTEGER]) {
    assert.equal(limit(matrixCompilationCapabilityConfig(config, input(attempt))), 49_152);
  }
});

test("simultaneous explicit output parameters fail closed even when their values agree", () => {
  const config = fixture("matrix_compiler", { max_tokens: 8192, max_completion_tokens: 8192 });
  assert.throws(() => matrixCompilationCapabilityConfig(config, input(1)), errorCode("MATRIX_OUTPUT_TOKEN_LIMIT_AMBIGUOUS"));
});

test("invalid explicit output parameters are not replaced with the limits fallback", () => {
  for (const parameter of ["max_tokens", "max_completion_tokens"] as const) {
    for (const invalid of [0, -1, 1.5, "8192", null, false, Number.NaN, Number.POSITIVE_INFINITY]) {
      const config = fixture("matrix_compiler", { [parameter]: invalid });
      assert.throws(() => matrixCompilationCapabilityConfig(config, input(1)), errorCode("MATRIX_OUTPUT_BUDGET_INVALID"));
    }
  }
});

test("invalid fallback limits and computation inputs fail with a safe code", () => {
  for (const invalid of [0, -1, 1.5, "8192", null, false, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => matrixCompilationCapabilityConfig(fixture("matrix_compiler", {}, invalid), input(1)), errorCode("MATRIX_OUTPUT_BUDGET_INVALID"));
  }
  const config = fixture();
  for (const key of ["compilationAttempt", "contextWindowTokens", "safetyTokens"] as const) {
    for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => matrixCompilationCapabilityConfig(config, input(1, { [key]: invalid })), errorCode("MATRIX_OUTPUT_BUDGET_INVALID"));
    }
  }
});

test("context allowance clamps the growing output reservation without trimming the input", () => {
  const config = fixture();
  const content = deepFreeze({ ...(userContent as Record<string, JsonValue>),
    syntheticLongInput: "This complete synthetic input must survive the budgeting step. ".repeat(2048),
  }) as JsonValue;
  const before = structuredClone(content);
  const configBefore = structuredClone(config);
  const contextWindowTokens = contextWithAvailableOutput(config, 10_000, content);
  const adjusted = matrixCompilationCapabilityConfig(config, input(3, { contextWindowTokens, userContent: content }));
  assert.equal(limit(adjusted), 10_000);
  assert.ok(countOpenAiCompatibleContextTokens({ config: adjusted, userContent: content, safetyTokens: 4096 }) <= contextWindowTokens);
  assert.deepEqual(content, before, "all original profile fields and source fragments must be preserved");
  assert.deepEqual(config, configBefore, "clamping may not alter the shared config");
});

test("the exact base allowance succeeds and one token less fails before any provider call", () => {
  const config = fixture();
  const contextWindowTokens = contextWithAvailableOutput(config, 8192);
  const adjusted = matrixCompilationCapabilityConfig(config, input(3, { contextWindowTokens }));
  assert.equal(limit(adjusted), 8192);
  assert.throws(() => matrixCompilationCapabilityConfig(config, input(3, { contextWindowTokens: contextWindowTokens - 1 })),
    errorCode("MATRIX_CONTEXT_BUDGET_EXCEEDED"));
});

test("explicit output limits preserve a fitting base across numeric tokenization boundaries", () => {
  for (const parameter of ["max_tokens", "max_completion_tokens"] as const) {
    const config = fixture("matrix_compiler", { [parameter]: 512, temperature: 0 }, 512);
    const contextWindowTokens = countOpenAiCompatibleContextTokens({ config, userContent, safetyTokens: 4096 });
    for (const attempt of [1, 2, 3]) {
      const adjusted = matrixCompilationCapabilityConfig(config, input(attempt, { contextWindowTokens }));
      assert.equal(limit(adjusted), 512, "a growing serialized limit must not exclude the original fitting base");
      assert.equal((adjusted.generationParameters as Record<string, JsonValue>)[parameter], 512);
      assert.ok(countOpenAiCompatibleContextTokens({ config: adjusted, userContent, safetyTokens: 4096 }) <= contextWindowTokens);
    }
    assert.throws(() => matrixCompilationCapabilityConfig(config, input(3, { contextWindowTokens: contextWindowTokens - 1 })),
      errorCode("MATRIX_CONTEXT_BUDGET_EXCEEDED"));
  }
});

test("non-draft capabilities retain their original object and output settings", () => {
  for (const capability of ["matrix_row_evaluation", "matrix_assessment_summary", "criterion_claim_extraction", "ocr"] as const) {
    const config = deepFreeze({ ...fixture(), capability });
    assert.equal(matrixCompilationCapabilityConfig(config, input(3)), config);
    assert.equal(limit(config), 8192);
  }
});
