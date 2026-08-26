import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { TelegramOutbox } from "../server/candidate-pipeline/providers.ts";
import { environmentProjection, loadRuntimeConfiguration } from "../server/configuration/runtime.ts";

const workspace = process.cwd();
const runtimeRoot = resolve(workspace, ".runtime");
const environment = environmentProjection(await loadRuntimeConfiguration(workspace));
const token = environment.TELEGRAM_BOT_TOKEN?.trim() ?? "";
const recipients = JSON.parse(environment.TELEGRAM_RECIPIENT_REFS_JSON ?? "{}") as Record<string, unknown>;
const registry = Object.fromEntries(Object.entries(recipients).map(([reference, chatId]) => {
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(reference) || !["string", "number"].includes(typeof chatId) || !String(chatId).trim()) throw new Error("TELEGRAM_RECIPIENT_REGISTRY_INVALID");
  return [reference, String(chatId)];
}));
if (!token || !Object.keys(registry).length) throw new Error("TELEGRAM_SMOKE_CONFIGURATION_INCOMPLETE");

const outbox = new TelegramOutbox({ token, recipients: registry });
const logicalKey = `local-provider-smoke:${randomUUID()}`;
const refs = Object.keys(registry);
outbox.enqueue(logicalKey, refs);
const deliveries = [];
for (const reference of refs) {
  const first = await outbox.send(logicalKey, reference, "Проверка сервиса найма: локальный Telegram-контур подключён. Это одно тестовое сообщение, действий не требуется.");
  const repeated = await outbox.send(logicalKey, reference, "Повтор не должен быть отправлен");
  if (first.state !== "SENT" || repeated.state !== "SENT" || repeated.attempts !== 1) throw new Error("TELEGRAM_SMOKE_DELIVERY_FAILED");
  deliveries.push({ state: repeated.state, attempts: repeated.attempts, safeIdentity: outbox.safeIdentity(repeated) });
}
const evidenceDirectory = resolve(runtimeRoot, "evidence");
await mkdir(evidenceDirectory, { recursive: true });
await writeFile(resolve(evidenceDirectory, "telegram-real-provider-smoke.json"), `${JSON.stringify({
  schemaVersion: "telegram-real-provider-smoke/v1",
  capturedAtUtc: new Date().toISOString(),
  environment: "local",
  providerMode: "real",
  recipientCount: deliveries.length,
  sentCount: deliveries.filter((item) => item.state === "SENT").length,
  duplicateSendPrevented: deliveries.every((item) => item.attempts === 1),
  deliveryEvidenceRefs: deliveries.map((item) => item.safeIdentity),
  productionLikeAcceptanceClaimed: false,
  containsCredentials: false,
  containsRecipientIds: false,
  containsPersonalData: false,
}, null, 2)}\n`, "utf8");
console.log("Telegram real-provider smoke: GREEN");
console.log(`Проверено получателей: ${deliveries.length}; повторная отправка заблокирована.`);
console.log("Токен и chat_id не выводились и не сохранялись в evidence.");
