import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { candidateToolErrorCode } from "./tool-executor.ts";

const phases = ["media-source-download", "media-processor-request", "media-response-read", "media-artifact-store"] as const;
type RunCandidatePhase = <T>(
  context: { runId: string; taskId: string; attemptId: string },
  phase: typeof phases[number],
  operation: () => Promise<T>,
  log?: (entry: Record<string, unknown>) => void,
) => Promise<T>;
const moduleUrl = new URL("./phase-diagnostics.ts", import.meta.url);
const implementationPresent = existsSync(moduleUrl);
// The pre-implementation seam demonstrates missing diagnostics, not production wiring.
// Existing-module import failures must fail normally, never activate the fallback.
const runCandidatePhase: RunCandidatePhase = implementationPresent
  ? (await import(moduleUrl.href)).runCandidatePhase
  : async (_context, _phase, operation) => operation();
const context = { runId: "synthetic-run", taskId: "synthetic-task", attemptId: "synthetic-attempt" };
const privateText = "synthetic-private-content https://example.invalid/private?token=synthetic";
const codes = ["CONNECT_TIMEOUT", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET"];

test("diagnostic acceptance explicitly identifies the pre-implementation seam", (t) => {
  t.diagnostic(implementationPresent
    ? "Testing the real runCandidatePhase export."
    : "SEAM LIMITATION: module absent; passthrough operation fallback tests missing diagnostics, not production integration.");
});

test("current persisted tool classification loses nested reason without requiring a policy change", () => {
  const error = new Error("synthetic fetch failed", { cause: Object.assign(new Error(privateText), { code: "UND_ERR_CONNECT_TIMEOUT" }) });
  assert.equal(candidateToolErrorCode(error), "PRODUCTION_TOOL_EXECUTION_FAILED");
});

async function assertDiagnostic(phase: typeof phases[number], error: Error, reasonCode: string) {
  const entries: Record<string, unknown>[] = [];
  const descriptors = Object.getOwnPropertyDescriptors(error);
  let calls = 0;
  await assert.rejects(runCandidatePhase(context, phase, async () => {
    calls++;
    throw error;
  }, (entry) => entries.push(entry)), (caught) => caught === error);
  assert.equal(calls, 1, "diagnostics must not retry the operation");
  assert.deepEqual(Object.getOwnPropertyDescriptors(error), descriptors, "original error remains unchanged");
  assert.equal(entries.length, 1, "one safe phase error record must be emitted");
  const entry = entries[0];
  assert.equal(typeof entry.elapsedMs, "number");
  assert.ok(Number.isFinite(entry.elapsedMs) && Number(entry.elapsedMs) >= 0);
  assert.deepEqual(entry, { event: "candidate-phase-error", ...context, phase, elapsedMs: entry.elapsedMs, reasonCode });
  assert.ok(!JSON.stringify(entry).includes(privateText));
}

for (const phase of phases) {
  test(`${phase}: preserves success without emitting an error record`, async () => {
    const entries: Record<string, unknown>[] = [];
    const result = { synthetic: true };
    let calls = 0;
    assert.equal(await runCandidatePhase(context, phase, async () => { calls++; return result; }, (entry) => entries.push(entry)), result);
    assert.equal(calls, 1);
    assert.deepEqual(entries, []);
  });
  test(`${phase}: emits correlated safe diagnostics and rethrows the same error`, async () => {
    await assertDiagnostic(phase, Object.assign(new Error(privateText), { code: "ECONNRESET", request: privateText, url: privateText, content: privateText }), "ECONNRESET");
  });
}

for (const code of codes) {
  for (const nested of [false, true]) {
    test(`allowlisted ${nested ? "nested cause" : "top-level"} code ${code}`, async () => {
      const transport = Object.assign(new Error(privateText), { code });
      const error = nested ? new Error(privateText, { cause: new Error(privateText, { cause: transport }) }) : transport;
      await assertDiagnostic("media-processor-request", error, code);
    });
  }
}

for (const code of [undefined, "SYNTHETIC_PRIVATE_CUSTOMER_CODE", privateText]) {
  test(`unknown code ${code === undefined ? "absent" : code === privateText ? "content" : "uppercase"} is not logged`, async () => {
    await assertDiagnostic("media-response-read", Object.assign(new Error(privateText), {
      code, cause: Object.assign(new Error(privateText), { code: "SYNTHETIC_NESTED_PRIVATE_CODE" }),
    }), "UNCLASSIFIED_ERROR");
  });
}

for (const [name, reasonCode] of [["TimeoutError", "TIMEOUT"], ["AbortError", "ABORTED"]]) {
  test(`${name} has a safe diagnostic reason`, async () => {
    await assertDiagnostic("media-source-download", new DOMException(privateText, name), reasonCode);
  });
}

test("logger failure never masks or mutates the original error or retries the operation", async () => {
  const error = Object.assign(new Error(privateText), { code: "ECONNRESET" });
  const descriptors = Object.getOwnPropertyDescriptors(error);
  let calls = 0;
  let logCalls = 0;
  await assert.rejects(runCandidatePhase(context, "media-artifact-store", async () => {
    calls++;
    throw error;
  }, () => { logCalls++; throw new Error("synthetic logger failure"); }), (caught) => caught === error);
  assert.equal(calls, 1);
  assert.deepEqual(Object.getOwnPropertyDescriptors(error), descriptors);
  assert.equal(logCalls, 1, "the logger must actually be exercised");
});
