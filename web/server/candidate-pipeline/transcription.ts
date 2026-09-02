import { sha256 } from "./core.ts";
import type { DurableAssemblyAiAdapter } from "./providers.ts";

export type TranscriptSourceIdentity = { sourceFileId: string; sourceFileVersion: string; sourceFileName: string };
export type TranscriptWord = { text: string; start: number; end: number; speaker: string; confidence: number } & Partial<TranscriptSourceIdentity>;
export type TranscriptUtterance = { utteranceId?: string; text: string; start: number; end: number; speaker: string; confidence: number; sourceLine?: number; timingOrigin?: "provider" | "explicit-text" | "derived-line-order" } & Partial<TranscriptSourceIdentity>;

export type ReadyTranscript = {
  schemaVersion: "ready-transcript/v1";
  source: { fileId: string; fileVersion: string; fileName: string; mimeType: string };
  text: string;
  words: readonly TranscriptWord[];
  utterances: readonly TranscriptUtterance[];
};

function timestampMilliseconds(value: string) {
  const normalized = value.trim().replace(",", ".");
  const parts = normalized.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part)) || parts.length < 2 || parts.length > 3) return undefined;
  const seconds = parts.pop()!;
  const minutes = parts.pop()!;
  const hours = parts.pop() ?? 0;
  return Math.round(((hours * 60 + minutes) * 60 + seconds) * 1000);
}

function splitSpeaker(value: string) {
  const match = value.match(/^(?:[-–—]\s*)?(?:(?:спикер|speaker)\s+)?([^:\n]{1,80}):\s*(.+)$/iu);
  return match ? { speaker: match[1].trim(), text: match[2].trim() } : { speaker: "UNKNOWN", text: value.trim() };
}

export function parseReadyTranscript(input: { fileId: string; fileVersion: string; fileName: string; mimeType: string; bytes?: Uint8Array; extractedText?: string }): ReadyTranscript {
  let decoded: string;
  try { decoded = input.extractedText ?? new TextDecoder("utf-8", { fatal: true }).decode(input.bytes ?? new Uint8Array()).replace(/^\uFEFF/u, ""); }
  catch { throw new Error("READY_TRANSCRIPT_INVALID_UTF8"); }
  const text = decoded.replace(/\r\n?/gu, "\n").trim();
  if (!text) throw new Error("READY_TRANSCRIPT_EMPTY");
  const lines = text.split("\n");
  const utterances: TranscriptUtterance[] = [];
  let cue: { start: number; end: number } | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || /^WEBVTT$/iu.test(line) || /^\d+$/u.test(line)) continue;
    const cueMatch = line.match(/^([\d:,\.]+)\s*-->\s*([\d:,\.]+)/u);
    if (cueMatch) {
      const start = timestampMilliseconds(cueMatch[1]);
      const end = timestampMilliseconds(cueMatch[2]);
      cue = start !== undefined && end !== undefined && end > start ? { start, end } : undefined;
      continue;
    }
    const inline = line.match(/^\[?([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?(?:[.,][0-9]{1,3})?)\]?(?:\s*[–—-]\s*\[?([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?(?:[.,][0-9]{1,3})?)\]?)?\s+(.+)$/u);
    const explicitStart = inline ? timestampMilliseconds(inline[1]) : cue?.start;
    const explicitEnd = inline?.[2] ? timestampMilliseconds(inline[2]) : cue?.end;
    const spoken = splitSpeaker(inline?.[3] ?? line);
    if (!spoken.text) continue;
    const derivedStart = utterances.at(-1)?.end ?? utterances.length * 1_000;
    const start = explicitStart ?? derivedStart;
    const end = explicitEnd && explicitEnd > start ? explicitEnd : start + 1_000;
    utterances.push({ text: spoken.text, start, end, speaker: spoken.speaker, confidence: 1, sourceLine: index + 1,
      timingOrigin: explicitStart !== undefined ? "explicit-text" : "derived-line-order" });
    cue = undefined;
  }
  if (!utterances.length) throw new Error("READY_TRANSCRIPT_NO_UTTERANCES");
  return Object.freeze({ schemaVersion: "ready-transcript/v1", source: { fileId: input.fileId, fileVersion: input.fileVersion, fileName: input.fileName, mimeType: input.mimeType },
    text, words: [], utterances: Object.freeze(utterances) });
}

export function audioArtifactIdentity(input: { sourceChecksum: string; extractionConfigVersion: string }) {
  return `audio:${sha256(input).slice(0, 24)}`;
}

export function transcriptRepresentations(input: { providerJobId: string; raw: Record<string, unknown>; words: readonly TranscriptWord[]; utterances: readonly TranscriptUtterance[]; source?: TranscriptSourceIdentity; threshold?: number }) {
  const threshold = input.threshold ?? 0.7;
  const words = input.words.map((word) => input.source ? { ...word, ...input.source } : { ...word });
  const utterances = input.utterances.map((utterance, index) => ({ ...utterance, ...(input.source ?? {}),
    ...(utterance.utteranceId ? {} : { utteranceId: input.source ? `${input.source.sourceFileId}:utterance-${index}` : `utterance-${index}` }) }));
  const lowWords = words.filter((word) => word.confidence < threshold).length;
  const lowUtterances = utterances.filter((utterance) => utterance.confidence < threshold).length;
  const normalized = Object.freeze({
    schemaVersion: "transcript/v1",
    providerJobId: input.providerJobId,
    words: structuredClone(words),
    utterances: structuredClone(utterances),
    lowConfidenceWordShare: words.length ? lowWords / words.length : 0,
    lowConfidenceUtteranceShare: utterances.length ? lowUtterances / utterances.length : 0,
  });
  const txt = utterances.map((item) => `${item.sourceFileName ? `[${item.sourceFileName}] ` : ""}${item.timingOrigin === "derived-line-order" && item.sourceLine
    ? `[строка ${item.sourceLine}] Спикер ${item.speaker}: ${item.text}`
    : `[${time(item.start)}–${time(item.end)}] Спикер ${item.speaker}: ${item.text}`}`).join("\n");
  return Object.freeze({ raw: structuredClone(input.raw), normalized, txt });
}

export function mergeTranscriptRepresentations(input: { providerJobId: string; sources: readonly ReturnType<typeof transcriptRepresentations>[] }) {
  if (!input.sources.length) throw new Error("TRANSCRIPT_SOURCES_EMPTY");
  const words = input.sources.flatMap((source) => source.normalized.words);
  const utterances = input.sources.flatMap((source) => source.normalized.utterances);
  const lowWords = words.filter((word) => word.confidence < 0.7).length;
  const lowUtterances = utterances.filter((utterance) => utterance.confidence < 0.7).length;
  return Object.freeze({
    raw: { schemaVersion: "multi-interview-raw/v1", providerJobId: input.providerJobId, sources: input.sources.map((source) => source.raw) },
    normalized: Object.freeze({ schemaVersion: "transcript/v1", providerJobId: input.providerJobId, words: structuredClone(words), utterances: structuredClone(utterances),
      lowConfidenceWordShare: words.length ? lowWords / words.length : 0,
      lowConfidenceUtteranceShare: utterances.length ? lowUtterances / utterances.length : 0 }),
    txt: input.sources.map((source) => source.txt).filter(Boolean).join("\n\n"),
  });
}

function time(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function speakerRoleArtifact(input: { transcriptArtifactId: string; mappings: readonly { speakerLabel: string; role: string | null; confidence: number; evidence: string }[] }) {
  return Object.freeze({ schemaVersion: "speaker-map/v1", transcriptArtifactId: input.transcriptArtifactId, mappings: structuredClone(input.mappings), providerLabelsPreserved: true });
}

export interface TranscriptionJobRepository {
  get(operationIdentity: string): { remoteJobId: string; state: "CREATED" | "COMPLETED"; output?: Record<string, unknown> } | undefined;
  save(operationIdentity: string, job: { remoteJobId: string; state: "CREATED" | "COMPLETED"; output?: Record<string, unknown> }): void;
}

export class InMemoryTranscriptionJobRepository implements TranscriptionJobRepository {
  private readonly jobs = new Map<string, { remoteJobId: string; state: "CREATED" | "COMPLETED"; output?: Record<string, unknown> }>();
  get(identity: string) { const value = this.jobs.get(identity); return value ? structuredClone(value) : undefined; }
  save(identity: string, job: { remoteJobId: string; state: "CREATED" | "COMPLETED"; output?: Record<string, unknown> }) { this.jobs.set(identity, structuredClone(job)); }
}

export class DurableTranscriptionJob {
  constructor(private readonly provider: DurableAssemblyAiAdapter, private readonly repository: TranscriptionJobRepository) {}

  async createOrResume(input: { audioUrl: string; operationIdentity: string }) {
    let saved = this.repository.get(input.operationIdentity);
    if (!saved) {
      await this.provider.create({ ...input, checkpoint: ({ remoteJobId }) => this.repository.save(input.operationIdentity, { remoteJobId, state: "CREATED" }) });
      saved = this.repository.get(input.operationIdentity);
    }
    if (!saved) throw new Error("REMOTE_JOB_CHECKPOINT_MISSING");
    if (saved.state === "COMPLETED") return saved.output!;
    const output = await this.provider.poll(saved.remoteJobId);
    if (output.status === "completed") this.repository.save(input.operationIdentity, { remoteJobId: saved.remoteJobId, state: "COMPLETED", output });
    return output;
  }

  async reconcile(operationIdentity: string) {
    const saved = this.repository.get(operationIdentity);
    if (!saved) return { state: "ABSENT" as const };
    if (saved.state === "COMPLETED") return { state: "CONFIRMED" as const, output: saved.output };
    const output = await this.provider.poll(saved.remoteJobId);
    return output.status === "completed" ? { state: "CONFIRMED" as const, output } : { state: "UNKNOWN" as const };
  }
}
