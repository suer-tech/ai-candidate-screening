import assert from "node:assert/strict";
import test from "node:test";
import { UnsupportedCandidateSchemaError, normalizeCandidateCapabilityOutput } from "./schemas.ts";

test("candidate capability schemas accept current controlled outputs", () => {
  assert.equal(normalizeCandidateCapabilityOutput("ocr", { schemaVersion: "ocr-page/v1", page: 1, text: "text", confidence: 0.9, regions: [] }).schemaVersion, "ocr-page/v1");
});

test("known old speaker schema migrates deterministically without inventing fields", () => {
  const migrated = normalizeCandidateCapabilityOutput("speaker_mapping", { schemaVersion: "speaker-map/v0", roles: [{ label: "A", role: "Кандидат" }] });
  assert.equal(migrated.schemaVersion, "speaker-map/v1");
  assert.deepEqual(migrated.mappings, [{ label: "A", role: "Кандидат" }]);
});

test("unknown or structurally invalid schemas fail explicitly", () => {
  assert.throws(() => normalizeCandidateCapabilityOutput("speaker_mapping", { schemaVersion: "speaker-map/v999" }), UnsupportedCandidateSchemaError);
  assert.throws(() => normalizeCandidateCapabilityOutput("ocr", { schemaVersion: "ocr-page/v1", page: 0, text: "", confidence: 2, regions: [] }), /INVALID_STRUCTURED_OUTPUT/);
});
