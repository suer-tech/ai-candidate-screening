import { basename } from "node:path";

import type { Transcript } from "assemblyai";

import type { TranscriptArtifact } from "./types.js";

function timestamp(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

export function safeArtifactBaseName(inputPath: string): string {
  return basename(inputPath)
    .replace(/[<>:"/\\|?*]/g, "_")
    .split("")
    .map((character) => (character.charCodeAt(0) < 32 ? "_" : character))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "meeting";
}

export function createTranscriptArtifact(
  transcript: Transcript,
  videoPath: string,
  audioPath: string,
  createdAt = new Date(),
): TranscriptArtifact {
  return {
    schemaVersion: 1,
    provider: "assemblyai",
    providerTranscriptId: transcript.id,
    source: {
      videoFileName: basename(videoPath),
      audioFileName: basename(audioPath),
    },
    languageCode: transcript.language_code ?? null,
    durationMs: transcript.audio_duration == null ? null : Math.round(transcript.audio_duration * 1_000),
    confidence: transcript.confidence ?? null,
    speechModel: transcript.speech_model_used ?? null,
    text: transcript.text ?? "",
    utterances: transcript.utterances ?? [],
    words: transcript.words ?? [],
    createdAt: createdAt.toISOString(),
  };
}

export function formatTranscriptText(artifact: TranscriptArtifact): string {
  const metadata = [
    "Стенограмма встречи",
    `AssemblyAI transcript ID: ${artifact.providerTranscriptId}`,
    `Язык: ${artifact.languageCode ?? "не определён"}`,
    `Длительность: ${artifact.durationMs == null ? "не определена" : timestamp(artifact.durationMs)}`,
    "",
  ];

  if (artifact.utterances.length === 0) {
    return [...metadata, artifact.text].join("\n").trimEnd() + "\n";
  }

  const lines = artifact.utterances.map(
    (utterance) =>
      `[${timestamp(utterance.start)}–${timestamp(utterance.end)}] Спикер ${utterance.speaker}: ${utterance.text}`,
  );
  return [...metadata, ...lines].join("\n").trimEnd() + "\n";
}
