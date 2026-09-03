const TRANSIENT_CODES = [
  /(?:^|_)(?:NETWORK|TIMEOUT)(?:_|$)/,
  /^LLM_CAPABILITY_FAILED:(?:timeout|network|rate_limit|provider_unavailable|invalid_provider_response|invalid_structured_output|missing_structured_output|incomplete_structured_output)$/,
  /_FAILED_(?:429|5\d\d)$/,
  /_HTTP_(?:429|5\d\d)$/,
  /^HTTP_(?:429|5\d\d)$/,
  /^LEASE_EXPIRED_RECOVERED$/,
];

const MAX_ATTEMPTS_BY_TOOL: Readonly<Record<string, number>> = Object.freeze({
  "candidate.drive-snapshot/v1": 3,
  "candidate.document-extraction/v1": 3,
  "candidate.transcription/v1": 3,
  "candidate.matrix-compile/v1": 3,
  "candidate.validation/v1": 3,
  "candidate.report/v1": 3,
  "candidate.drive-publication/v1": 3,
  "candidate.telegram/v1": 3,
  "candidate.document-shard/v1": 3,
  "candidate.transcript-shard/v1": 3,
  "candidate.transcript-normalize-shard/v1": 3,
  "candidate.transcript-media-shard/v1": 3,
  "candidate.transcript-submit-shard/v1": 3,
  "candidate.transcript-collect-shard/v1": 3,
  "candidate.evidence-shard/v1": 3,
  "candidate.row-shard/v1": 3,
  "candidate.abc-shard/v1": 3,
  "candidate.critical-shard/v1": 3,
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
  "LLM_CAPABILITY_FAILED:provider_unavailable": "Сервис модели временно недоступен. Система выполнила разрешённые повторы; запустите обработку повторно, если сервис ещё не восстановился",
  "LLM_CAPABILITY_FAILED:network": "Не удалось получить ответ модели из-за временной сетевой ошибки. Система выполнила разрешённые повторы",
  "LLM_CAPABILITY_FAILED:rate_limit": "Сервис модели временно ограничил частоту запросов. Система выполнила разрешённые повторы",
});

export function candidateFailureMessage(errorCode: string) {
  if (errorCode.startsWith("FANOUT_REQUIRED_SHARD_FAILED:")) return "Не удалось обработать один обязательный фрагмент материалов кандидата. Остальные кандидаты продолжают обрабатываться; повторный запуск переиспользует уже готовые фрагменты";
  if (errorCode.includes("JOIN_COVERAGE_INVALID") || errorCode === "FANOUT_MEMBERSHIP_INCOMPLETE") return "Не удалось собрать полный результат из параллельно обработанных частей. Повторный запуск переиспользует успешно завершённые части";
  return RUSSIAN_FAILURES[errorCode] ?? "Обработка завершилась с ошибкой. Повторите запуск или обратитесь к администратору";
}
