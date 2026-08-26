import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as matrixDriven from "../server/candidate-pipeline/matrix-driven.ts";

type DecisionSafeJson = (value: unknown) => unknown;

const sensitiveFixture = {
  schemaVersion: "candidate-materials/v1",
  documents: [{
    locator: "resume:page:1",
    text: "Опыт управления командой. Возраст: 39 лет",
    confidence: 0.98,
    metadata: {
      "возраст-key-must-survive": "обычное значение",
      active: true,
      page: 1,
      empty: null,
    },
  }],
  transcript: {
    segments: [
      { speaker: "candidate", text: "У меня двое детей", startMs: 1250 },
      { speaker: "candidate", text: "Готов работать офлайн в Москве", startMs: 4200 },
    ],
  },
};

test("MDA-CONTEXT-RED-001: recursive decision-safe JSON sanitizes string leaves without changing shape or types", () => {
  const exported = matrixDriven as unknown as Record<string, unknown>;
  const sanitize = exported.decisionSafeJson as DecisionSafeJson | undefined;
  const failures: string[] = [];

  if (typeof sanitize !== "function") {
    failures.push("matrix-driven.ts must export decisionSafeJson(value) for recursive leaf-only sanitization");
  } else {
    const projected = sanitize(sensitiveFixture) as typeof sensitiveFixture;
    if (projected === sensitiveFixture) failures.push("sanitizer must return a detached projection instead of mutating/reusing the input root");
    if (projected.documents[0] === sensitiveFixture.documents[0]) failures.push("nested objects must be detached from untrusted input");
    if (projected.documents[0].text.includes("39 лет")) failures.push("sensitive age text was not sanitized");
    if (projected.transcript.segments[0].text.includes("двое детей")) failures.push("sensitive family text was not sanitized");
    if (projected.transcript.segments[1].text !== sensitiveFixture.transcript.segments[1].text) failures.push("non-sensitive string leaf changed");
    if (!("возраст-key-must-survive" in projected.documents[0].metadata)) failures.push("object keys are structure, not string leaves, and must not be sanitized");
    if (projected.documents[0].metadata.active !== true) failures.push("boolean type/value changed");
    if (projected.documents[0].metadata.page !== 1) failures.push("number type/value changed");
    if (projected.documents[0].metadata.empty !== null) failures.push("null type/value changed");
    if (!Array.isArray(projected.documents) || !Array.isArray(projected.transcript.segments)) failures.push("array shape changed");
    try {
      const roundTrip = JSON.parse(JSON.stringify(projected));
      assert.deepEqual(roundTrip, projected);
    } catch (error) {
      failures.push(`sanitized projection is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!sensitiveFixture.documents[0].text.includes("39 лет") || !sensitiveFixture.transcript.segments[0].text.includes("двое детей")) {
      failures.push("sanitizer mutated the source material");
    }
  }

  assert.deepEqual(failures, []);
});

test("MDA-CONTEXT-RED-002: production context-read never sanitizes a serialized JSON envelope with regex", () => {
  const source = readFileSync(new URL("../server/candidate-pipeline/production-runtime.ts", import.meta.url), "utf8");
  const contextReadStart = source.indexOf('toolKey === "candidate.matrix-context-read/v1"');
  const nextToolStart = source.indexOf('toolKey === "candidate.matrix-claims/v1"', contextReadStart);
  assert.ok(contextReadStart >= 0 && nextToolStart > contextReadStart, "production context-read branch must exist");
  const contextReadSource = source.slice(contextReadStart, nextToolStart);

  assert.doesNotMatch(
    contextReadSource,
    /JSON\.parse\s*\(\s*decisionSafeText\s*\(\s*JSON\.stringify\s*\(/,
    "stringify→regex→parse may consume JSON delimiters; context-read must sanitize parsed values recursively",
  );
  assert.match(contextReadSource, /decisionSafeJson\s*\(\s*documents\s*\)/, "documents must use recursive JSON sanitizer");
  assert.match(contextReadSource, /decisionSafeJson\s*\(\s*transcript\s*\)/, "transcript must use recursive JSON sanitizer");
});

test("MDA-CONTEXT-RED-003: fixture reproduces delimiter corruption in the forbidden stringify-regex-parse pipeline", () => {
  const serialized = JSON.stringify(sensitiveFixture);
  const corrupted = matrixDriven.decisionSafeText(serialized);
  assert.throws(
    () => JSON.parse(corrupted),
    SyntaxError,
    "fixture must keep reproducing the live JSON delimiter corruption that recursive sanitization prevents",
  );
});
