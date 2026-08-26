import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { renderCandidatePdf, requiredReportSections, type ReportModel } from "../server/candidate-pipeline/reports.ts";
import { environmentProjection, loadRuntimeConfiguration } from "../server/configuration/runtime.ts";

const execute = promisify(execFile);
const workspace = process.cwd();
const repository = resolve(workspace, "..");
const runtimeRoot = resolve(workspace, ".runtime");
const environment = environmentProjection(await loadRuntimeConfiguration(workspace));
const token = environment.AGENT_RUNTIME_INTERNAL_TOKEN;
if (!token) throw new Error("AGENT_RUNTIME_INTERNAL_TOKEN_MISSING");
const effectful = process.argv.includes("--effectful");
const routing = effectful ? "effectful" : "shadow";
if (environment.CANDIDATE_TOOL_EXECUTION_MODE !== "production" || environment.CANDIDATE_PIPELINE_ROUTING !== routing) {
  throw new Error(`CANDIDATE_SMOKE_REQUIRES_PRODUCTION_EXECUTOR_AND_${routing.toUpperCase()}_ROUTING`);
}
const recipientConfiguration = environment.TELEGRAM_RECIPIENT_REFS_JSON;
if (!recipientConfiguration) throw new Error("TELEGRAM_RECIPIENT_REFS_MISSING");

const work = resolve(runtimeRoot, "tmp", `candidate-shadow-${randomUUID()}`);
const wave = resolve(work, "synthetic-interview.wav");
await mkdir(work, { recursive: true });
let handle: string | undefined;
let finalTasks: Array<{ key: string; state: string; safeCode?: string }> = [];
let finalEffects = { publishedDocumentCount: 0, sentNotificationCount: 0 };
let failure: unknown;

async function request(body: Record<string, unknown>) {
  const response = await fetch(new URL("/api/internal/candidate-pipeline/shadow-smoke", environment.INTERNAL_APP_ORIGIN || environment.APP_ORIGIN), {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok || payload.ready !== true) throw new Error(typeof payload.code === "string" ? payload.code : `SHADOW_SMOKE_HTTP_${response.status}`);
  return payload;
}

try {
  if (process.platform !== "win32") throw new Error("LOCAL_SYNTHETIC_SPEECH_WINDOWS_ONLY");
  await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", resolve(repository, "deploy/local/generate-synthetic-speech.ps1"), "-OutputPath", wave],
    { windowsHide: true, timeout: 120_000 });
  const model: ReportModel = {
    type: "candidate-results",
    candidateId: "synthetic-candidate",
    candidateDisplayName: "Синтетический кандидат",
    vacancyId: "synthetic-vacancy",
    vacancyTitle: "Синтетический инженер TypeScript",
    profileVersion: "synthetic/v1",
    analysisVersion: 1,
    generatedAtUtc: new Date().toISOString(),
    recommendation: "Недостаточно данных",
    sections: requiredReportSections("candidate-results").map((id) => ({ id, title: id,
      body: id === "confirmed-results" ? "Кандидат поддерживал сервис на TypeScript два года и сообщил об уменьшении времени обработки заявок на двадцать процентов."
        : "Синтетический материал для локальной проверки конвейера без персональных данных." })),
    evidence: [],
  };
  const resume = await renderCandidatePdf(model);
  const interview = new Uint8Array(await readFile(wave));
  const provisioned = await request({ action: "provision", mode: routing, resumeBase64: Buffer.from(resume).toString("base64"), interviewBase64: Buffer.from(interview).toString("base64") });
  handle = String(provisioned.handle);
  const deadline = Date.now() + 25 * 60_000;
  let runState = "ACTIVE";
  while (Date.now() < deadline) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 3_000));
    const status = await request({ action: "status", handle });
    runState = String(status.runState ?? "UNKNOWN");
    finalTasks = Array.isArray(status.tasks) ? status.tasks as typeof finalTasks : [];
    if (status.effects && typeof status.effects === "object") {
      const effects = status.effects as Record<string, unknown>;
      finalEffects = { publishedDocumentCount: Number(effects.publishedDocumentCount ?? 0), sentNotificationCount: Number(effects.sentNotificationCount ?? 0) };
    }
    if (["SUCCEEDED", "FAILED", "WAITING_FOR_HUMAN"].includes(runState) || finalTasks.some((task) => task.state === "FAILED")) break;
  }
  const required = ["drive-snapshot", "documents", "transcription", "evidence", "assessment", "validation", "reports", "publication", "notification"];
  const failed = finalTasks.filter((task) => task.state !== "SUCCEEDED");
  if (runState !== "SUCCEEDED" || failed.length || required.some((key) => !finalTasks.some((task) => task.key === key))) {
    const first = failed[0];
    throw new Error(first?.safeCode ?? `SHADOW_PIPELINE_${runState}`);
  }
  const configuredRecipientCount = Object.keys(JSON.parse(recipientConfiguration) as Record<string, string>).length;
  if (effectful && (finalEffects.publishedDocumentCount !== 2 || finalEffects.sentNotificationCount !== configuredRecipientCount || configuredRecipientCount < 1)) {
    throw new Error("EFFECTFUL_PIPELINE_EFFECT_COUNTS_INVALID");
  }
  if (!effectful && (finalEffects.publishedDocumentCount !== 0 || finalEffects.sentNotificationCount !== 0)) {
    throw new Error("SHADOW_PIPELINE_LEAKED_VISIBLE_EFFECTS");
  }
  const evidenceDirectory = resolve(runtimeRoot, "evidence");
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(resolve(evidenceDirectory, effectful ? "candidate-effectful-real-providers.json" : "candidate-shadow-real-providers.json"), `${JSON.stringify({
    schemaVersion: effectful ? "candidate-effectful-real-providers/v1" : "candidate-shadow-real-providers/v1",
    capturedAtUtc: new Date().toISOString(),
    environment: "local",
    routing,
    providerMode: "real",
    stages: finalTasks.map((task) => ({ key: task.key, state: task.state })),
    visibleDrivePublication: effectful,
    telegramDelivery: effectful,
    effects: finalEffects,
    productionLikeAcceptanceClaimed: false,
    containsCredentials: false,
    containsProviderIds: false,
    containsDriveIds: false,
    containsPersonalData: false,
  }, null, 2)}\n`, "utf8");
  console.log(`Candidate pipeline real-provider ${routing} smoke: GREEN`);
  console.log(effectful
    ? "Проверено: полный контур с публикацией двух PDF в personal Drive и durable Telegram delivery; тестовые объекты будут очищены."
    : "Проверено: personal Drive → PDF/DOCX boundary → media/AssemblyAI → RouterAI evidence/assessment → validation/PDF; публикация и Telegram подавлены shadow policy.");
} catch (error) {
  failure = error;
} finally {
  if (handle) {
    try {
      const cleanup = await request({ action: "cleanup", handle });
      const checks = cleanup.cleanup as Record<string, boolean> | undefined;
      if (!checks || Object.values(checks).some((value) => value !== true)) failure ??= new Error("SHADOW_SMOKE_CLEANUP_INCOMPLETE");
    } catch (error) {
      failure ??= error;
    }
  }
  await rm(work, { recursive: true, force: true });
}
if (failure) throw failure;
