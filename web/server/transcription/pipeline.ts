import { copyFile, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { Transcript } from "assemblyai";

import {
  DEFAULT_ASSEMBLYAI_BASE_URL,
  deleteRemoteTranscript,
  transcribeAudio,
} from "./assemblyai-client.js";
import { extractAudioTrack } from "./extract-audio.js";
import {
  createTranscriptArtifact,
  formatTranscriptText,
  safeArtifactBaseName,
} from "./format-transcript.js";
import type { PipelineResult, TranscriptionProgress } from "./types.js";

export interface RunTranscriptionPipelineOptions {
  inputPath: string;
  outputDirectory: string;
  apiKey?: string;
  baseUrl?: string;
  speakersExpected?: number;
  extractOnly?: boolean;
  keepAudio?: boolean;
  deleteRemoteCopy?: boolean;
  progress?: TranscriptionProgress;
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, contents, { encoding: "utf8", mode: 0o600 });
  await rm(path, { force: true });
  await rename(temporaryPath, path);
}

export async function runTranscriptionPipeline(
  options: RunTranscriptionPipelineOptions,
): Promise<PipelineResult> {
  const inputPath = resolve(options.inputPath);
  const outputDirectory = resolve(options.outputDirectory);
  const baseName = safeArtifactBaseName(inputPath);
  const progress = options.progress ?? (() => undefined);
  const workDirectory = await mkdtemp(join(tmpdir(), "candidate-transcription-"));
  const temporaryAudioPath = join(workDirectory, `${baseName}.audio.m4a`);
  let transcript: Transcript | null = null;

  await mkdir(outputDirectory, { recursive: true });

  try {
    progress("extracting_audio", "Извлекаю аудиодорожку из видео");
    const extracted = await extractAudioTrack({ inputPath, outputPath: temporaryAudioPath });
    let audioPath: string | null = null;

    if (options.keepAudio || options.extractOnly) {
      audioPath = join(outputDirectory, `${baseName}.audio.m4a`);
      await copyFile(extracted.path, audioPath);
    }

    if (options.extractOnly) {
      progress("completed", "Аудиодорожка извлечена");
      return {
        audioPath,
        rawTranscriptPath: null,
        transcriptPath: null,
        textPath: null,
        transcript: null,
        remoteTranscriptDeleted: false,
      };
    }

    if (!options.apiKey) {
      throw new Error("Для транскрибации необходим API-ключ AssemblyAI.");
    }

    progress("uploading_and_transcribing", "Отправляю аудио и ожидаю стенограмму");
    transcript = await transcribeAudio({
      apiKey: options.apiKey,
      audioPath: extracted.path,
      baseUrl: options.baseUrl,
      speakersExpected: options.speakersExpected,
    });

    progress("saving_results", "Сохраняю стенограмму и данные для дальнейшего анализа");
    const artifact = createTranscriptArtifact(transcript, inputPath, extracted.path);
    const rawTranscriptPath = join(outputDirectory, `${baseName}.assemblyai.json`);
    const transcriptPath = join(outputDirectory, `${baseName}.transcript.json`);
    const textPath = join(outputDirectory, `${baseName}.transcript.txt`);

    await Promise.all([
      atomicWrite(rawTranscriptPath, `${JSON.stringify(transcript, null, 2)}\n`),
      atomicWrite(transcriptPath, `${JSON.stringify(artifact, null, 2)}\n`),
      atomicWrite(textPath, formatTranscriptText(artifact)),
    ]);

    let remoteTranscriptDeleted = false;
    if (options.deleteRemoteCopy !== false) {
      progress("deleting_remote_copy", "Удаляю удалённую копию после локального сохранения");
      await deleteRemoteTranscript(
        options.apiKey,
        transcript.id,
        options.baseUrl ?? DEFAULT_ASSEMBLYAI_BASE_URL,
      );
      remoteTranscriptDeleted = true;
    }

    progress("completed", "Стенограмма готова");
    return {
      audioPath,
      rawTranscriptPath,
      transcriptPath,
      textPath,
      transcript,
      remoteTranscriptDeleted,
    };
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
}
