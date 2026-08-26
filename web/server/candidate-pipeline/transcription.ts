import { sha256 } from "./core.ts";
import type { DurableAssemblyAiAdapter } from "./providers.ts";

export type TranscriptWord = { text: string; start: number; end: number; speaker: string; confidence: number };
export type TranscriptUtterance = { text: string; start: number; end: number; speaker: string; confidence: number };

export function audioArtifactIdentity(input: { sourceChecksum: string; extractionConfigVersion: string }) {
  return `audio:${sha256(input).slice(0, 24)}`;
}

export function transcriptRepresentations(input: { providerJobId: string; raw: Record<string, unknown>; words: readonly TranscriptWord[]; utterances: readonly TranscriptUtterance[]; threshold?: number }) {
  const threshold = input.threshold ?? 0.7;
  const lowWords = input.words.filter((word) => word.confidence < threshold).length;
  const lowUtterances = input.utterances.filter((utterance) => utterance.confidence < threshold).length;
  const normalized = Object.freeze({
    schemaVersion: "transcript/v1",
    providerJobId: input.providerJobId,
    words: structuredClone(input.words),
    utterances: structuredClone(input.utterances),
    lowConfidenceWordShare: input.words.length ? lowWords / input.words.length : 0,
    lowConfidenceUtteranceShare: input.utterances.length ? lowUtterances / input.utterances.length : 0,
  });
  const txt = input.utterances.map((item) => `[${time(item.start)}–${time(item.end)}] Спикер ${item.speaker}: ${item.text}`).join("\n");
  return Object.freeze({ raw: structuredClone(input.raw), normalized, txt });
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
