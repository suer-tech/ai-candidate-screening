import assert from "node:assert/strict";
import test from "node:test";
import { parseReadyTranscript } from "../server/candidate-pipeline/transcription.ts";

test("DOCX extracted transcript treats standalone speaker headers as context, not utterances", () => {
  const extractedText = [
    "Спикер 1:",
    "00:00:01 - Добрый день.",
    "00:00:03 - Расскажите о проекте.",
    "Спикер 2:",
    "00:00:05 - Я составила редакционный план.",
    "00:00:08 - Важно проверить метрики.",
  ].join("\n");
  const parsed = parseReadyTranscript({
    fileId: "synthetic-interview-docx",
    fileVersion: "immutable-synthetic-v1",
    fileName: "Синтетическая стенограмма.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extractedText,
  });

  assert.equal(parsed.text, extractedText, "the source text remains available unchanged");
  assert.deepEqual(parsed.utterances.map(({ speaker, text, start, end, sourceLine, timingOrigin }) => ({
    speaker, text, start, end, sourceLine, timingOrigin,
  })), [
    { speaker: "1", text: "Добрый день.", start: 1_000, end: 2_000, sourceLine: 2, timingOrigin: "explicit-text" },
    { speaker: "1", text: "Расскажите о проекте.", start: 3_000, end: 4_000, sourceLine: 3, timingOrigin: "explicit-text" },
    { speaker: "2", text: "Я составила редакционный план.", start: 5_000, end: 6_000, sourceLine: 5, timingOrigin: "explicit-text" },
    { speaker: "2", text: "Важно проверить метрики.", start: 8_000, end: 9_000, sourceLine: 6, timingOrigin: "explicit-text" },
  ]);
});
