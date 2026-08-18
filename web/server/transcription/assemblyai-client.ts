import { AssemblyAI, type Transcript, type TranscribeParams } from "assemblyai";

export const DEFAULT_ASSEMBLYAI_BASE_URL = "https://api.eu.assemblyai.com";

export interface AssemblyAiTranscriptionOptions {
  apiKey: string;
  audioPath: string;
  baseUrl?: string;
  speakersExpected?: number;
  pollingTimeoutMs?: number;
}

export function readAssemblyAiApiKey(
  environment: Record<string, string | undefined> = process.env,
): string {
  const apiKey = environment.ASSEMBLYAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Не задана переменная окружения ASSEMBLYAI_API_KEY.");
  }
  return apiKey;
}

export function buildTranscriptionParams(
  audioPath: string,
  speakersExpected?: number,
): TranscribeParams {
  if (speakersExpected !== undefined && (!Number.isInteger(speakersExpected) || speakersExpected < 1)) {
    throw new Error("Количество говорящих должно быть положительным целым числом.");
  }

  return {
    audio: audioPath,
    language_code: "ru",
    speech_models: ["universal-2"],
    speaker_labels: true,
    punctuate: true,
    format_text: true,
    ...(speakersExpected === undefined ? {} : { speakers_expected: speakersExpected }),
  };
}

function createClient(apiKey: string, baseUrl: string): AssemblyAI {
  return new AssemblyAI({ apiKey, baseUrl });
}

export async function transcribeAudio(options: AssemblyAiTranscriptionOptions): Promise<Transcript> {
  const baseUrl = options.baseUrl ?? DEFAULT_ASSEMBLYAI_BASE_URL;
  const client = createClient(options.apiKey, baseUrl);
  const transcript = await client.transcripts.transcribe(
    buildTranscriptionParams(options.audioPath, options.speakersExpected),
    {
      pollingInterval: 3_000,
      pollingTimeout: options.pollingTimeoutMs ?? 30 * 60 * 1_000,
    },
  );

  if (transcript.status === "error") {
    throw new Error(`AssemblyAI не смог выполнить транскрибацию: ${transcript.error ?? "неизвестная ошибка"}`);
  }
  if (transcript.status !== "completed") {
    throw new Error(`Неожиданный статус AssemblyAI: ${transcript.status}`);
  }

  return transcript;
}

export async function deleteRemoteTranscript(
  apiKey: string,
  transcriptId: string,
  baseUrl = DEFAULT_ASSEMBLYAI_BASE_URL,
): Promise<void> {
  const client = createClient(apiKey, baseUrl);
  await client.transcripts.delete(transcriptId);
}
