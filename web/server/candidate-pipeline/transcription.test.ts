import assert from "node:assert/strict";
import test from "node:test";
import { DurableAssemblyAiAdapter } from "./providers.ts";
import { DurableTranscriptionJob, InMemoryTranscriptionJobRepository, audioArtifactIdentity, parseReadyTranscript, speakerRoleArtifact, transcriptRepresentations } from "./transcription.ts";

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

test("ready transcript preserves explicit timestamps and uses honest line locators when time is absent", () => {
  const parsed = parseReadyTranscript({ fileId: "text-1", fileVersion: "7", fileName: "Стенограмма.txt", mimeType: "text/plain",
    bytes: new TextEncoder().encode("[00:01:02] Интервьюер: Расскажите о себе\nКандидат: Я вела календарь руководителя") });
  assert.deepEqual(parsed.utterances.map(({ speaker, text, sourceLine, timingOrigin }) => ({ speaker, text, sourceLine, timingOrigin })), [
    { speaker: "Интервьюер", text: "Расскажите о себе", sourceLine: 1, timingOrigin: "explicit-text" },
    { speaker: "Кандидат", text: "Я вела календарь руководителя", sourceLine: 2, timingOrigin: "derived-line-order" },
  ]);
  assert.equal(parsed.utterances[1].start, parsed.utterances[0].end);
  const rendered = transcriptRepresentations({ providerJobId: "ready-transcript:1", raw: {}, words: parsed.words, utterances: parsed.utterances }).txt;
  assert.match(rendered, /\[01:02–01:03\]/u);
  assert.match(rendered, /\[строка 2\]/u);
  assert.doesNotMatch(rendered, /\[01:03–01:04\].*Я вела/u);
});

test("empty or invalid ready transcript fails with a typed error", () => {
  assert.throws(() => parseReadyTranscript({ fileId: "empty", fileVersion: "1", fileName: "Стенограмма.txt", mimeType: "text/plain", bytes: new Uint8Array() }), /READY_TRANSCRIPT_EMPTY/);
  assert.throws(() => parseReadyTranscript({ fileId: "invalid", fileVersion: "1", fileName: "Стенограмма.txt", mimeType: "text/plain", bytes: new Uint8Array([0xff]) }), /READY_TRANSCRIPT_INVALID_UTF8/);
});
