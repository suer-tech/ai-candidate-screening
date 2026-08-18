import assert from "node:assert/strict";
import test from "node:test";

import type { Transcript } from "assemblyai";

import { buildTranscriptionParams, readAssemblyAiApiKey } from "./assemblyai-client.js";
import {
  createTranscriptArtifact,
  formatTranscriptText,
  safeArtifactBaseName,
} from "./format-transcript.js";

test("builds a Russian diarized transcription request", () => {
  const params = buildTranscriptionParams("meeting.m4a", 2);
  assert.equal("audio" in params ? params.audio : null, "meeting.m4a");
  assert.equal(params.language_code, "ru");
  assert.deepEqual(params.speech_models, ["universal-2"]);
  assert.equal(params.speaker_labels, true);
  assert.equal(params.speakers_expected, 2);
});

test("does not accept a missing API key", () => {
  assert.throws(() => readAssemblyAiApiKey({}), /ASSEMBLYAI_API_KEY/);
  assert.equal(readAssemblyAiApiKey({ ASSEMBLYAI_API_KEY: "  secret  " }), "secret");
});

test("creates a stable transcript artifact for downstream models", () => {
  const transcript = {
    id: "transcript-1",
    status: "completed",
    text: "Здравствуйте. Добрый день.",
    language_code: "ru",
    audio_duration: 4,
    confidence: 0.92,
    speech_model_used: "universal-2",
    utterances: [
      {
        speaker: "A",
        start: 0,
        end: 1_500,
        confidence: 0.95,
        text: "Здравствуйте.",
        words: [],
      },
      {
        speaker: "B",
        start: 1_700,
        end: 4_000,
        confidence: 0.91,
        text: "Добрый день.",
        words: [],
      },
    ],
    words: [],
  } as unknown as Transcript;

  const artifact = createTranscriptArtifact(
    transcript,
    "C:/candidate/Запись встречи 14.08",
    "C:/temp/audio.m4a",
    new Date("2026-08-17T10:00:00.000Z"),
  );

  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.durationMs, 4_000);
  assert.equal(artifact.utterances.length, 2);
  assert.match(formatTranscriptText(artifact), /\[00:00:00–00:00:01\] Спикер A: Здравствуйте\./);
  assert.equal(safeArtifactBaseName("C:/candidate/Запись встречи 14.08"), "Запись встречи 14.08");
});
