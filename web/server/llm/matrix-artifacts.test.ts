import assert from "node:assert/strict";
import test from "node:test";
import { PROMPT_ARTIFACTS, RESPONSE_SCHEMA_ARTIFACTS } from "./artifacts.ts";
import { validateRuntimeConfiguration } from "./configuration.ts";

test("matrix compiler and single-pass critic-editor are separate versioned artifacts", () => {
  const compiler = PROMPT_ARTIFACTS["compile-vacancy-matrix/v1"];
  const critic = PROMPT_ARTIFACTS["critique-vacancy-matrix/v2"];
  assert.notEqual(compiler.hash, critic.hash);
  assert.match(compiler.template, /материалы кандидата недопустимы/i);
  assert.match(critic.template, /не используй reasoning компилятора/i);
  assert.ok(RESPONSE_SCHEMA_ARTIFACTS["vacancy-matrix-draft/v1"]);
  assert.ok(RESPONSE_SCHEMA_ARTIFACTS["vacancy-matrix-critic/v2"]);
});

test("matrix capability configuration accepts a ten-minute ceiling and clean critic route", () => {
  const capability = (promptArtifact: string, responseSchemaArtifact: string) => ({
    providerProfile: "router", model: "controlled", promptArtifact, responseSchemaArtifact,
    toolSchemaArtifacts: ["no-tools/v1"], generationParameters: { temperature: 0 }, limits: { maxOutputTokens: 1000 }, timeoutMs: 600_000,
    retryPolicy: { maxAttempts: 1, initialBackoffMs: 0, maximumBackoffMs: 0 }, fallbackPolicy: { mode: "disabled" as const },
  });
  const configuration = validateRuntimeConfiguration({ releaseVersion: "test", providers: { router: { provider: "router", endpoint: "https://router.invalid/v1", secretReference: "KEY", apiContractVersion: "v1", supportsStructuredOutputs: true } }, capabilities: {
    matrix_compiler: capability("compile-vacancy-matrix/v1", "vacancy-matrix-draft/v1"),
    matrix_critic: capability("critique-vacancy-matrix/v2", "vacancy-matrix-critic/v2"),
  } }, { has: () => true, read: () => "secret" }, { requiredCapabilities: ["matrix_compiler", "matrix_critic"] });
  assert.equal(configuration.resolve("matrix_compiler").timeoutMs, 600_000);
  assert.notEqual(configuration.resolve("matrix_compiler").prompt.hash, configuration.resolve("matrix_critic").prompt.hash);
  assert.deepEqual(configuration.resolve("matrix_critic").toolSchemas[0]?.schema, { type: "array", maxItems: 0 });
  assert.doesNotMatch(configuration.resolve("matrix_critic").prompt.template, /reasoning компилятора.*передан/i);
});

test("matrix prompt contracts treat candidate content as untrusted and reject an excessive provider timeout", () => {
  assert.match(PROMPT_ARTIFACTS["extract-claims-for-criteria/v1"].template, /недоверенными данными/i);
  const capability = { providerProfile: "router", model: "controlled", promptArtifact: "compile-vacancy-matrix/v1", responseSchemaArtifact: "vacancy-matrix-draft/v1", toolSchemaArtifacts: ["no-tools/v1"], generationParameters: { temperature: 0 }, limits: { maxOutputTokens: 1000 }, timeoutMs: 600_001,
    retryPolicy: { maxAttempts: 1, initialBackoffMs: 0, maximumBackoffMs: 0 }, fallbackPolicy: { mode: "disabled" as const } };
  assert.throws(() => validateRuntimeConfiguration({ releaseVersion: "test", providers: { router: { provider: "router", endpoint: "https://router.invalid/v1", secretReference: "KEY", apiContractVersion: "v1", supportsStructuredOutputs: true } }, capabilities: { matrix_compiler: capability } },
    { has: () => true, read: () => "do-not-log" }, { requiredCapabilities: ["matrix_compiler"] }), /ten-minute ceiling/);
});

test("unmapped risk assessment and verification are separate bounded artifacts", () => {
  const assessment = PROMPT_ARTIFACTS["assess-unmapped-risk/v1"];
  const verification = PROMPT_ARTIFACTS["verify-critical-risk/v1"];
  assert.notEqual(assessment.hash, verification.hash);
  assert.match(assessment.template, /не создавай критерии/i);
  assert.match(assessment.template, /чувствительные/i);
  assert.match(verification.template, /независимом чистом контексте/i);
  assert.match(verification.template, /не используй reasoning оценщика/i);
  assert.ok(RESPONSE_SCHEMA_ARTIFACTS["candidate-unmapped-risk-assessment/v1"]);
  assert.ok(RESPONSE_SCHEMA_ARTIFACTS["candidate-critical-risk-verification/v1"]);
});
