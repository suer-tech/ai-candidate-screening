import { resolve } from "node:path";

import { readAssemblyAiApiKey } from "./assemblyai-client.js";
import { runTranscriptionPipeline } from "./pipeline.js";

interface CliOptions {
  inputPath: string;
  outputDirectory: string;
  extractOnly: boolean;
  keepAudio: boolean;
  keepRemote: boolean;
  speakersExpected?: number;
  baseUrl?: string;
}

function usage(): string {
  return `Использование:
  npm run transcribe:candidate -- --input <видео> --output <каталог> [параметры]

Параметры:
  --extract-only       Только извлечь аудио, не вызывать AssemblyAI
  --keep-audio         Сохранить извлечённую аудиодорожку рядом со стенограммой
  --keep-remote        Не удалять результат из AssemblyAI после локального сохранения
  --speakers <число>   Точное число говорящих, только если оно достоверно известно
  --base-url <url>     API endpoint; по умолчанию используется EU endpoint
  --help               Показать эту справку
`;
}

function valueAfter(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`После ${flag} требуется значение.`);
  }
  return value;
}

export function parseCliArguments(args: string[]): CliOptions {
  let inputPath: string | undefined;
  let outputDirectory: string | undefined;
  let extractOnly = false;
  let keepAudio = false;
  let keepRemote = false;
  let speakersExpected: number | undefined;
  let baseUrl: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case "--input":
        inputPath = valueAfter(args, index, argument);
        index += 1;
        break;
      case "--output":
        outputDirectory = valueAfter(args, index, argument);
        index += 1;
        break;
      case "--speakers": {
        const value = valueAfter(args, index, argument);
        speakersExpected = Number(value);
        if (!Number.isInteger(speakersExpected) || speakersExpected < 1) {
          throw new Error("--speakers должен быть положительным целым числом.");
        }
        index += 1;
        break;
      }
      case "--base-url":
        baseUrl = valueAfter(args, index, argument);
        index += 1;
        break;
      case "--extract-only":
        extractOnly = true;
        break;
      case "--keep-audio":
        keepAudio = true;
        break;
      case "--keep-remote":
        keepRemote = true;
        break;
      case "--help":
        process.stdout.write(usage());
        process.exit(0);
        break;
      default:
        throw new Error(`Неизвестный параметр: ${argument}`);
    }
  }

  if (!inputPath || !outputDirectory) {
    throw new Error("Обязательны параметры --input и --output.");
  }

  return {
    inputPath: resolve(inputPath),
    outputDirectory: resolve(outputDirectory),
    extractOnly,
    keepAudio,
    keepRemote,
    speakersExpected,
    baseUrl,
  };
}

async function main(): Promise<void> {
  const options = parseCliArguments(process.argv.slice(2));
  const apiKey = options.extractOnly ? undefined : readAssemblyAiApiKey();
  const result = await runTranscriptionPipeline({
    inputPath: options.inputPath,
    outputDirectory: options.outputDirectory,
    apiKey,
    baseUrl: options.baseUrl,
    speakersExpected: options.speakersExpected,
    extractOnly: options.extractOnly,
    keepAudio: options.keepAudio,
    deleteRemoteCopy: !options.keepRemote,
    progress: (_stage, message) => process.stderr.write(`${message}…\n`),
  });

  const createdFiles = [result.audioPath, result.transcriptPath, result.textPath, result.rawTranscriptPath].filter(
    (path): path is string => Boolean(path),
  );
  process.stdout.write(`${createdFiles.join("\n")}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Ошибка транскрибации: ${message}\n`);
  process.exitCode = 1;
});
