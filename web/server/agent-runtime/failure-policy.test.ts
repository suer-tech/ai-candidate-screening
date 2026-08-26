import assert from "node:assert/strict";
import test from "node:test";
import { candidateFailureMessage, taskFailurePolicy } from "./failure-policy.ts";

test("temporary provider failures retry with bounded backoff", () => {
  assert.deepEqual(taskFailurePolicy("candidate.transcription/v1", "ASSEMBLYAI_POLL_FAILED_503", 1), { retry: true, delayMs: 5_000, maxAttempts: 3 });
  assert.deepEqual(taskFailurePolicy("candidate.transcription/v1", "ASSEMBLYAI_POLL_FAILED_503", 2), { retry: true, delayMs: 15_000, maxAttempts: 3 });
  assert.deepEqual(taskFailurePolicy("candidate.transcription/v1", "ASSEMBLYAI_POLL_FAILED_503", 3), { retry: false, delayMs: 0, maxAttempts: 3 });
});

test("immutable input changes are terminal and have a clear Russian message", () => {
  assert.deepEqual(taskFailurePolicy("candidate.transcription/v1", "DRIVE_FILE_CONTENT_CHANGED", 1), { retry: false, delayMs: 0, maxAttempts: 3 });
  assert.equal(candidateFailureMessage("DRIVE_FILE_CONTENT_CHANGED"), "Файл интервью изменился после фиксации материалов. Дождитесь стабилизации файлов и запустите обработку повторно");
});

test("LLM terminal failures have a clear Russian message", () => {
  assert.match(candidateFailureMessage("LLM_CAPABILITY_FAILED:timeout"), /Модель не успела завершить ответ/);
  assert.match(candidateFailureMessage("LLM_CAPABILITY_FAILED:invalid_provider_response"), /Модель не вернула корректный ответ/);
});
