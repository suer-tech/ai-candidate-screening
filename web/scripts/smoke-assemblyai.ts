import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { DurableAssemblyAiAdapter } from "../server/candidate-pipeline/providers.ts";
import { environmentProjection, loadRuntimeConfiguration } from "../server/configuration/runtime.ts";

const run = promisify(execFile);
const workspace = process.cwd();
const repository = resolve(workspace, "..");
const runtimeRoot = resolve(workspace, ".runtime");

const environment = environmentProjection(await loadRuntimeConfiguration(workspace));
const apiKey = environment.ASSEMBLYAI_API_KEY?.trim();
if (!apiKey) throw new Error("ASSEMBLYAI_API_KEY_EMPTY");
const work = resolve(runtimeRoot, "tmp", `assemblyai-smoke-${randomUUID()}`);
const wave = resolve(work, "two-voice-synthetic.wav");
await mkdir(work, { recursive: true });
let remoteJobId: string | undefined;
let cleanupFailed = false;
const started = Date.now();
try {
  if (process.platform !== "win32") throw new Error("ASSEMBLYAI_SMOKE_SYNTHETIC_SPEECH_WINDOWS_ONLY");
  await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", resolve(repository, "deploy/local/generate-synthetic-speech.ps1"), "-OutputPath", wave], { windowsHide: true, timeout: 120_000 });
  const audioBytes = new Uint8Array(await readFile(wave));
  const adapter = new DurableAssemblyAiAdapter({ apiKey });
  await adapter.create({ audioBytes, operationIdentity: `assemblyai-smoke-${randomUUID()}`, checkpoint: (value) => { remoteJobId = value.remoteJobId; } });
  if (!remoteJobId) throw new Error("ASSEMBLYAI_SMOKE_CHECKPOINT_MISSING");
  let transcript: Record<string, unknown> | undefined;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    transcript = await adapter.poll(remoteJobId);
    if (transcript.status === "completed" || transcript.status === "error") break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 3_000));
  }
  if (transcript?.status !== "completed") throw new Error("ASSEMBLYAI_SMOKE_NOT_COMPLETED");
  const utterances = Array.isArray(transcript.utterances) ? transcript.utterances : [];
  const words = Array.isArray(transcript.words) ? transcript.words : [];
  if (!words.length || !utterances.length) throw new Error("ASSEMBLYAI_SMOKE_STRUCTURED_TRANSCRIPT_EMPTY");
  const speakers = new Set(utterances.flatMap((item) => item && typeof item === "object" && "speaker" in item ? [String(item.speaker)] : []));
  const evidenceDirectory = resolve(runtimeRoot, "evidence");
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(resolve(evidenceDirectory, "assemblyai-real-provider-smoke.json"), `${JSON.stringify({
    schemaVersion: "assemblyai-real-provider-smoke/v1",
    capturedAtUtc: new Date().toISOString(),
    environment: "local",
    providerMode: "real",
    endpointRegion: "eu",
    speechModel: "universal-2",
    languageCode: "ru",
    speakerLabelsRequested: true,
    structuredWordsPresent: words.length > 0,
    structuredUtterancesPresent: utterances.length > 0,
    observedSpeakerLabelCount: speakers.size,
    durationMs: Date.now() - started,
    remoteCleanupRequired: true,
    productionLikeAcceptanceClaimed: false,
    containsCredentials: false,
    containsPersonalData: false,
  }, null, 2)}\n`, "utf8");
  console.log("AssemblyAI real-provider smoke: GREEN");
  console.log(`Проверено: EU upload/create/poll, structured words/utterances, speaker labels=${speakers.size}.`);
  console.log("Ключ, job ID, исходная стенограмма и аудиобайты не выводились.");
} finally {
  if (remoteJobId) {
    try { await new DurableAssemblyAiAdapter({ apiKey }).remove(remoteJobId); }
    catch { cleanupFailed = true; }
  }
  await rm(work, { recursive: true, force: true });
}
if (cleanupFailed) throw new Error("ASSEMBLYAI_SMOKE_REMOTE_CLEANUP_FAILED");
