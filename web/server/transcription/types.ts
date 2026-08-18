import type { Transcript, TranscriptUtterance, TranscriptWord } from "assemblyai";

export type TranscriptionProgressStage =
  | "extracting_audio"
  | "uploading_and_transcribing"
  | "saving_results"
  | "deleting_remote_copy"
  | "completed";

export type TranscriptionProgress = (stage: TranscriptionProgressStage, message: string) => void;

export interface ExtractedAudio {
  path: string;
  sizeBytes: number;
  mode: "stream_copy" | "aac_transcode";
}

export interface TranscriptArtifact {
  schemaVersion: 1;
  provider: "assemblyai";
  providerTranscriptId: string;
  source: {
    videoFileName: string;
    audioFileName: string;
  };
  languageCode: string | null;
  durationMs: number | null;
  confidence: number | null;
  speechModel: string | null;
  text: string;
  utterances: TranscriptUtterance[];
  words: TranscriptWord[];
  createdAt: string;
}

export interface PipelineResult {
  audioPath: string | null;
  rawTranscriptPath: string | null;
  transcriptPath: string | null;
  textPath: string | null;
  transcript: Transcript | null;
  remoteTranscriptDeleted: boolean;
}
