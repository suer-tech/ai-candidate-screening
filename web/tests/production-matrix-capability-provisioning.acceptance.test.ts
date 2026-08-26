import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MATRIX_CAPABILITY_SCHEMAS } from "../server/candidate-pipeline/matrix-schemas.ts";

test("MATRIX-CAPABILITY-PROVISIONING-RED-001: production tool execution provisions every legacy and matrix-v2 LLM capability it invokes", async () => {
  const source = await readFile(new URL("../server/candidate-pipeline/production-runtime.ts", import.meta.url), "utf8");
  const provisioning = source.match(/configuration:\s*loadRuntimeConfiguration\(input\.environment,\s*\[([^\]]*)\]\)/s);
  assert.ok(provisioning, "createProductionCandidateToolExecution must explicitly provision its LLM capabilities");
  const provisioned = new Set([...provisioning[1].matchAll(/["']([a-z_]+)["']/g)].map((match) => match[1]));
  const matrixCapabilities = Object.keys(MATRIX_CAPABILITY_SCHEMAS);
  const legacyCapabilities = ["ocr", "fact_extraction", "assessment"];
  const runtimeMatrixCalls = [...new Set([...source.matchAll(/\bcall\(["']([a-z_]+)["']/g)].map((match) => match[1]))];
  const failures: string[] = [];
  for (const capability of [...legacyCapabilities, ...matrixCapabilities]) {
    if (!provisioned.has(capability)) failures.push(`required production capability is not provisioned: ${capability}`);
  }
  for (const capability of runtimeMatrixCalls) {
    if (!provisioned.has(capability)) failures.push(`production runtime invokes an unprovisioned capability: ${capability}`);
  }
  if (new Set(matrixCapabilities).size !== matrixCapabilities.length) failures.push("matrix capability registry contains duplicates");
  if (runtimeMatrixCalls.some((capability) => !matrixCapabilities.includes(capability))) failures.push("production runtime invokes a matrix capability outside MATRIX_CAPABILITY_SCHEMAS");
  assert.deepEqual(failures, []);
});
