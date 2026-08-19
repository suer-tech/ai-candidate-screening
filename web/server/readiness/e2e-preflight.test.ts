import assert from "node:assert/strict";
import test from "node:test";
import { evaluateProductionReadiness, REQUIRED_TABLES, type PreflightDependencies } from "./e2e-preflight.ts";

function dependencies(overrides: Partial<PreflightDependencies> = {}): PreflightDependencies {
  const environment = {
    GOOGLE_DRIVE_HEALTHCHECK_URL: "https://drive.example.invalid/health",
    GOOGLE_DRIVE_HEALTHCHECK_TOKEN: "drive-health-secret",
    GOOGLE_DRIVE_VACANCY_FOLDER_URL: "https://drive.example.invalid/folders",
    GOOGLE_DRIVE_VACANCY_FOLDER_TOKEN: "drive-folder-secret",
    GOOGLE_DRIVE_RESULT_PDF_URL: "https://drive.example.invalid/results",
    GOOGLE_DRIVE_RESULT_PDF_TOKEN: "drive-result-secret",
    ASSEMBLYAI_API_KEY: "stt-secret",
    E2E_LLM_SMOKE_URL: "https://llm.example.invalid/smoke",
    E2E_LLM_SMOKE_TOKEN: "llm-secret",
    E2E_STT_SMOKE_URL: "https://stt.example.invalid/smoke",
    E2E_STT_SMOKE_TOKEN: "stt-smoke-secret",
  };
  return {
    identity: "synthetic-hr",
    database: { prepare: () => ({ bind: () => ({ all: async () => ({ results: REQUIRED_TABLES.map((name) => ({ name })) }) }) }) },
    traceBucket: { list: async () => ({ objects: [], truncated: false, delimitedPrefixes: [] }) },
    environment,
    validateLlm() {},
    fetcher: async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("drive")) return Response.json({ connected: true, providerMode: "real", permissions: { readInputs: true, createOutputs: true, manageMembers: false } });
      return Response.json({ ready: true, providerMode: "real" });
    },
    ...overrides,
  } as unknown as PreflightDependencies;
}

test("production preflight requires all real infrastructure checks", async () => {
  const result = await evaluateProductionReadiness(dependencies());
  assert.equal(result.ready, true);
  assert.deepEqual(result.checks.map((item) => item.name), ["identity", "d1", "r2", "drive", "llm", "stt"]);
});

test("production preflight reports every missing dependency without secret content", async () => {
  const result = await evaluateProductionReadiness(dependencies({ identity: null, database: undefined, traceBucket: undefined, environment: {} }));
  assert.equal(result.ready, false);
  assert.deepEqual(result.checks.map((item) => item.detail), [
    "HR_IDENTITY_MISSING",
    "D1_BINDING_MISSING",
    "R2_BINDING_MISSING",
    "GOOGLE_DRIVE_HEALTHCHECK_URL_MISSING",
    "E2E_LLM_SMOKE_URL_MISSING",
    "ASSEMBLYAI_API_KEY_MISSING",
  ]);
  assert.doesNotMatch(JSON.stringify(result), /secret/i);
});

test("production preflight rejects mock provider declarations and unsafe Drive permissions", async () => {
  const fetcher = async (input: RequestInfo | URL) => {
    if (String(input).includes("drive")) return Response.json({ connected: true, providerMode: "real", permissions: { readInputs: true, createOutputs: true, manageMembers: true } });
    return Response.json({ ready: true, providerMode: "mock" });
  };
  const result = await evaluateProductionReadiness(dependencies({ fetcher }));
  assert.equal(result.ready, false);
  assert.equal(result.checks.find((item) => item.name === "drive")?.detail, "DRIVE_PERMISSIONS_INVALID");
  assert.equal(result.checks.find((item) => item.name === "llm")?.detail, "LLM_SMOKE_NOT_REAL");
  assert.equal(result.checks.find((item) => item.name === "stt")?.detail, "STT_SMOKE_NOT_REAL");
});
