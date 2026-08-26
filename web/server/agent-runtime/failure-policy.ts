const TRANSIENT_CODES = [
  /(?:^|_)(?:NETWORK|TIMEOUT)(?:_|$)/,
  /_FAILED_(?:429|5\d\d)$/,
  /_HTTP_(?:429|5\d\d)$/,
  /^HTTP_(?:429|5\d\d)$/,
  /^LEASE_EXPIRED_RECOVERED$/,
];

const MAX_ATTEMPTS_BY_TOOL: Readonly<Record<string, number>> = Object.freeze({
  "candidate.drive-snapshot/v1": 3,
  "candidate.document-extraction/v1": 3,
  "candidate.transcription/v1": 3,
  "candidate.evidence-extraction/v1": 3,
  "candidate.assessment/v1": 3,
  "candidate.validation/v1": 3,
  "candidate.report-pair/v1": 3,
  "candidate.drive-publication/v1": 3,
  "candidate.telegram/v1": 3,
});

const BACKOFF_MS = [5_000, 15_000, 45_000] as const;

export function taskFailurePolicy(toolKey: string, errorCode: string, attemptCount: number) {
  const maxAttempts = MAX_ATTEMPTS_BY_TOOL[toolKey] ?? 1;
  const transient = TRANSIENT_CODES.some((pattern) => pattern.test(errorCode));
  const retry = transient && attemptCount < maxAttempts;
  return { retry, delayMs: retry ? BACKOFF_MS[Math.min(Math.max(attemptCount - 1, 0), BACKOFF_MS.length - 1)] : 0, maxAttempts };
}

const RUSSIAN_FAILURES: Readonly<Record<string, string>> = Object.freeze({
  DRIVE_FILE_VERSION_CHANGED: "Файл изменился после фиксации материалов. Дождитесь стабилизации файлов и запустите обработку повторно",
  DRIVE_FILE_CONTENT_CHANGED: "Файл интервью изменился после фиксации материалов. Дождитесь стабилизации файлов и запустите обработку повторно",
  CORRUPT_FILE: "Один из файлов повреждён или не может быть прочитан. Замените файл и после стабилизации запустите обработку повторно",
  ASSEMBLYAI_TRANSCRIPTION_FAILED: "Сервис транскрибации не смог обработать запись интервью",
  ASSEMBLYAI_TRANSCRIPTION_TIMEOUT: "Сервис транскрибации не завершил обработку за отведённое время",
  GOOGLE_DRIVE_REAUTH_REQUIRED: "Требуется повторно подключить Google Drive",
  "LLM_CAPABILITY_FAILED:timeout": "Модель не успела завершить ответ за отведённое время после разрешённых повторов. Запустите обработку повторно",
  "LLM_CAPABILITY_FAILED:invalid_provider_response": "Модель не вернула корректный ответ после разрешённых повторов. Запустите обработку повторно; если ошибка повторится, обратитесь к администратору",
});

export function candidateFailureMessage(errorCode: string) {
  return RUSSIAN_FAILURES[errorCode] ?? "Обработка завершилась с ошибкой. Повторите запуск или обратитесь к администратору";
}
