import assert from "node:assert/strict";
import test from "node:test";
import { partitionEvidenceLocators } from "./production-runtime.ts";
import type { EvidenceLocator } from "./types.ts";

test("evidence locators are distributed across a bounded number of nonempty batches", () => {
  const locators = Object.fromEntries(Array.from({ length: 95 }, (_, index) => [`locator-${index}`, {
    kind: "document", fileId: "file", fileVersion: "v1", artifactId: "artifact", exactText: `fact ${index}`, page: 1, section: "synthetic",
  } as EvidenceLocator]));
  const batches = partitionEvidenceLocators(locators);
  assert.equal(batches.length, 5);
  assert.equal(batches.reduce((sum, batch) => sum + Object.keys(batch).length, 0), 95);
  assert.equal(new Set(batches.flatMap((batch) => Object.keys(batch))).size, 95);
});

test("evidence locators are also partitioned by serialized payload size", () => {
  const locators = Object.fromEntries(Array.from({ length: 4 }, (_, index) => [`large-locator-${index}`, {
    kind: "document", fileId: "file", fileVersion: "v1", artifactId: "artifact", exactText: "x".repeat(40_000), page: 1, section: "synthetic",
  } as EvidenceLocator]));
  const batches = partitionEvidenceLocators(locators, 6, 20, 60_000);
  assert.equal(batches.length, 3);
  assert.equal(batches.reduce((sum, batch) => sum + Object.keys(batch).length, 0), 4);
});
