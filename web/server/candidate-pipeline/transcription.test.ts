import assert from "node:assert/strict";
import test from "node:test";
import { DurableAssemblyAiAdapter } from "./providers.ts";
import { DurableTranscriptionJob, InMemoryTranscriptionJobRepository, audioArtifactIdentity, speakerRoleArtifact, transcriptRepresentations } from "./transcription.ts";

test("compatible audio config produces reusable identity", () => {
  assert.equal(audioArtifactIdentity({ sourceChecksum: "source", extractionConfigVersion: "ffmpeg-v1" }), audioArtifactIdentity({ sourceChecksum: "source", extractionConfigVersion: "ffmpeg-v1" }));
  assert.notEqual(audioArtifactIdentity({ sourceChecksum: "source", extractionConfigVersion: "ffmpeg-v1" }), audioArtifactIdentity({ sourceChecksum: "source", extractionConfigVersion: "ffmpeg-v2" }));
});

test("restart resumes checkpointed AssemblyAI job without duplicate create", async () => {
  let creates = 0;
  const provider = new DurableAssemblyAiAdapter({ apiKey: "secret", fetch: async (_input, init) => {
    if (init?.method === "POST") { creates += 1; return new Response(JSON.stringify({ id: "job-1", status: "queued" }), { status: 200 }); }
    return new Response(JSON.stringify({ id: "job-1", status: "completed", words: [], utterances: [] }), { status: 200 });
  } });
  const repository = new InMemoryTranscriptionJobRepository();
  const firstWorker = new DurableTranscriptionJob(provider, repository);
  assert.equal((await firstWorker.createOrResume({ audioUrl: "https://controlled.invalid/audio", operationIdentity: "op-1" })).status, "completed");
  const restartedWorker = new DurableTranscriptionJob(provider, repository);
  assert.equal((await restartedWorker.createOrResume({ audioUrl: "https://controlled.invalid/audio", operationIdentity: "op-1" })).status, "completed");
  assert.equal(creates, 1);
});

test("raw, normalized and TXT representations stay consistent while role map preserves labels", () => {
  const representations = transcriptRepresentations({ providerJobId: "job-1", raw: { id: "job-1" }, words: [{ text: "Тест", start: 0, end: 500, speaker: "A", confidence: 0.6 }, { text: "ответ", start: 500, end: 1000, speaker: "A", confidence: 0.9 }], utterances: [{ text: "Тест ответ", start: 0, end: 1000, speaker: "A", confidence: 0.65 }] });
  assert.equal(representations.normalized.lowConfidenceWordShare, 0.5);
  assert.equal(representations.normalized.lowConfidenceUtteranceShare, 1);
  assert.match(representations.txt, /Спикер A/);
  const mapping = speakerRoleArtifact({ transcriptArtifactId: "transcript-1", mappings: [{ speakerLabel: "A", role: null, confidence: 0.4, evidence: "Недостаточно данных" }] });
  assert.equal(mapping.providerLabelsPreserved, true);
  assert.equal(mapping.mappings[0].speakerLabel, "A");
});
