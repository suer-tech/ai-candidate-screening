import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { classifyMaterials } from "../server/candidate-pipeline/core.ts";
import { recoveryArtifactSchema } from "../server/candidate-pipeline/recovery-contracts.ts";
import * as transcription from "../server/candidate-pipeline/transcription.ts";
import type { DriveObject } from "../server/candidate-pipeline/types.ts";

type ReadyInput = { fileId: string; fileVersion: string; fileName: string; mimeType: string; bytes: Uint8Array };
const parser = (transcription as unknown as { parseReadyTranscript?: (input: ReadyInput) => any }).parseReadyTranscript;

const object = (fileId: string, name: string, mimeType: string): DriveObject => ({
  fileId, parentFolderId: "synthetic-candidate", version: "immutable-v1", name, mimeType, size: 128,
  modifiedTime: "2026-08-28T00:00:00.000Z",
});
const resume = object("resume", "Synthetic resume.pdf", "application/pdf");
const readyText = object("ready-text", "Интервью — готовая стенограмма.txt", "text/plain");
const recording = object("recording", "Интервью.mp4", "video/mp4");

test("WF-010: resume plus one transcript-like text is complete and identifies ready-transcript without changing recording classification", () => {
  const ready = classifyMaterials([resume, readyText]);
  assert.equal(ready.complete, true);
  assert.deepEqual(ready.interviewIds, ["ready-text"]);
  assert.equal(ready.entries.find((entry) => entry.fileId === "ready-text")?.interviewSource, "ready-transcript");

  const media = classifyMaterials([resume, recording]);
  assert.equal(media.complete, true, "existing audio/video route must remain complete");
  assert.equal(media.entries.find((entry) => entry.fileId === "recording")?.interviewSource, "recording");

  const ambiguous = classifyMaterials([resume, recording, readyText]);
  assert.equal(ambiguous.complete, false);
  assert.deepEqual(ambiguous.ambiguities, ["MULTIPLE_INTERVIEWS"]);

  const ordinaryText = classifyMaterials([resume, object("notes", "Дополнительные заметки.txt", "text/plain")]);
  assert.equal(ordinaryText.entries.find((entry) => entry.fileId === "notes")?.role, "additional", "arbitrary text must not become an interview");
});

test("INT-032: deterministic parser preserves source text, speakers and explicit time while untimed evidence remains line-addressed", () => {
  assert.equal(typeof parser, "function", "public deterministic ready-transcript parser is missing");
  const explicitSource = "[00:01:02.500] Интервьюер: Расскажите о встречах.\n[00:01:05.000 - 00:01:09.250] Кандидат: Готовлю контекст заранее.";
  const explicitInput = { fileId: "ready-text", fileVersion: "immutable-v1", fileName: readyText.name, mimeType: readyText.mimeType, bytes: new TextEncoder().encode(explicitSource) };
  const first = parser!(explicitInput);
  const second = parser!(explicitInput);
  assert.deepEqual(first, second, "same immutable text must produce the same parsed transcript");
  assert.equal(first.text, explicitSource);
  assert.deepEqual(first.utterances.map(({ speaker, text, start, end, sourceLine, timingOrigin }) => ({ speaker, text, start, end, sourceLine, timingOrigin })), [
    { speaker: "Интервьюер", text: "Расскажите о встречах.", start: 62_500, end: 63_500, sourceLine: 1, timingOrigin: "explicit-text" },
    { speaker: "Кандидат", text: "Готовлю контекст заранее.", start: 65_000, end: 69_250, sourceLine: 2, timingOrigin: "explicit-text" },
  ]);

  const untimedSource = "Интервьюер: Когда готовы выйти?\nКандидат: Через две недели.";
  const untimed = parser!({ ...explicitInput, bytes: new TextEncoder().encode(untimedSource) });
  assert.deepEqual(untimed.utterances.map(({ speaker, text, sourceLine, timingOrigin }) => ({ speaker, text, sourceLine, timingOrigin })), [
    { speaker: "Интервьюер", text: "Когда готовы выйти?", sourceLine: 1, timingOrigin: "derived-line-order" },
    { speaker: "Кандидат", text: "Через две недели.", sourceLine: 2, timingOrigin: "derived-line-order" },
  ]);
  const rendered = transcription.transcriptRepresentations({ providerJobId: "ready-transcript:synthetic", raw: untimed as unknown as Record<string, unknown>, words: untimed.words, utterances: untimed.utterances });
  assert.match(rendered.txt, /\[строка 1\]/u);
  assert.match(rendered.txt, /\[строка 2\]/u);
  assert.doesNotMatch(rendered.txt, /\[00:00[–-]/u, "derived monotonic coordinates must not be presented as original interview time");
});

test("INT-032: ready-text application projection creates the normal transcript representation with zero media/STT calls", async () => {
  assert.equal(typeof parser, "function", "public ready-text transcript projection boundary is missing");
  let externalCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { externalCalls += 1; throw new Error("ready text must bypass media processor and AssemblyAI"); }) as typeof fetch;
  try {
    const parsed = parser!({ fileId: "ready-text", fileVersion: "immutable-v1", fileName: readyText.name, mimeType: readyText.mimeType,
      bytes: new TextEncoder().encode("Интервьюер: Вопрос.\nКандидат: Ответ.") });
    const bundle = transcription.transcriptRepresentations({ providerJobId: "ready-transcript:synthetic", raw: parsed, words: parsed.words, utterances: parsed.utterances });
    assert.equal(bundle.normalized.schemaVersion, "transcript/v1");
    assert.equal((bundle.raw as { schemaVersion?: string }).schemaVersion, "ready-transcript/v1");
    assert.equal(externalCalls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("INT-032: empty or unparseable ready text fails with stable typed errors", () => {
  assert.equal(typeof parser, "function", "public deterministic ready-transcript parser is missing");
  const base = { fileId: "ready-text", fileVersion: "immutable-v1", fileName: readyText.name, mimeType: readyText.mimeType };
  assert.throws(() => parser!({ ...base, bytes: new TextEncoder().encode(" \r\n ") }), /READY_TRANSCRIPT_EMPTY/);
  assert.throws(() => parser!({ ...base, bytes: new TextEncoder().encode("WEBVTT\n\n1\n") }), /READY_TRANSCRIPT_NO_UTTERANCES/);
  assert.throws(() => parser!({ ...base, bytes: new Uint8Array([0xff, 0xfe, 0xfd]) }), /READY_TRANSCRIPT_INVALID_UTF8/);
});

test("INT-032/WF-030: production ready-text branch persists transcript-bundle and keeps downstream/recovery family unchanged", () => {
  assert.equal(recoveryArtifactSchema("matrix-v3", "candidate.transcription/v1"), "transcript-bundle/v1");
  const runtimePath = fileURLToPath(new URL("../server/candidate-pipeline/production-runtime.ts", import.meta.url));
  const source = readFileSync(runtimePath, "utf8");
  const failures: string[] = [];
  if (!/interviewSource\s*===\s*["']ready-transcript["']/u.test(source)) failures.push("production transcription has no explicit ready-transcript route");
  if (!/parseReadyTranscript\(/u.test(source) || !/transcriptRepresentations\(/u.test(source)) failures.push("production route does not use deterministic ready-text projection");
  if (!/kind:\s*["']transcript-bundle["']/u.test(source)) failures.push("production route does not persist the normal transcript-bundle artifact kind");
  const readyStart = source.search(/interviewSource\s*===\s*["']ready-transcript["']/u);
  const recordingStart = readyStart < 0 ? -1 : source.indexOf("if (!input.environment.ASSEMBLYAI_API_KEY", readyStart);
  const readyBranch = readyStart < 0 ? "" : source.slice(readyStart, recordingStart < 0 ? readyStart + 3000 : recordingStart);
  if (/MEDIA_PROCESSOR_URL|DurableAssemblyAiAdapter|provider\.create\(|provider\.poll\(/u.test(readyBranch)) failures.push("ready-transcript branch still reaches media processor or AssemblyAI");
  assert.deepEqual(failures, []);
});
