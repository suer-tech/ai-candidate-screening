import { sha256 } from "./core.ts";
import type { PostgresClient } from "../storage/postgres.ts";
import { withTransaction } from "../storage/postgres.ts";

export type NotificationType = "candidate-ready" | "candidate-failed";
export type DeliveryState = "PENDING" | "SENDING" | "SENT" | "FAILED" | "WAITING_CONFIGURATION";

export type SafeNotificationEvent = {
  candidateId: number;
  runId: string;
  logicalKey: string;
  type: NotificationType;
  safePayload: Record<string, string>;
  createdAtUtc: string;
};

export type DurableDelivery = {
  id: string;
  eventId: string;
  logicalKey: string;
  recipientRef: string;
  state: DeliveryState;
  attempts: number;
  providerMessageId?: string;
  nextAttemptAtUtc?: string;
  safePayload: Record<string, string>;
};

const CONFIGURATION_RECIPIENT = "__server_configuration__";
const BACKOFF_MS = [5_000, 15_000, 45_000] as const;

export class ServerRecipientRegistry {
  private constructor(private readonly recipients: Readonly<Record<string, string>>) {}

  static parse(json: string | undefined) {
    if (!json?.trim()) return new ServerRecipientRegistry({});
    let source: unknown;
    try { source = JSON.parse(json); } catch { throw new Error("TELEGRAM_RECIPIENTS_INVALID_JSON"); }
    if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("TELEGRAM_RECIPIENTS_INVALID");
    const recipients: Record<string, string> = {};
    for (const [reference, value] of Object.entries(source)) {
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(reference) || typeof value !== "string" || !/^-?\d{1,20}$/.test(value)) throw new Error("TELEGRAM_RECIPIENTS_INVALID");
      recipients[reference] = value;
    }
    return new ServerRecipientRegistry(Object.freeze(recipients));
  }

  references() { return Object.keys(this.recipients); }
  resolve(reference: string) { return this.recipients[reference]; }
  safeConfiguration() { return { configured: this.references().length > 0, recipientCount: this.references().length }; }
}

export interface NotificationStore {
  register(event: SafeNotificationEvent, recipientRefs: readonly string[]): Promise<DurableDelivery[]>;
  due(nowUtc: string, limit?: number): Promise<DurableDelivery[]>;
  claim(id: string, nowUtc: string): Promise<DurableDelivery | null>;
  sent(id: string, messageId: string): Promise<void>;
  retry(id: string, nextAttemptAtUtc: string): Promise<void>;
  unknown(id: string, reconcileAtUtc: string): Promise<void>;
  failed(id: string): Promise<void>;
  reconcileUnknown(nowUtc: string): Promise<number>;
  manualRetry(id: string, recipientConfigured: boolean): Promise<boolean>;
}

export class PostgresNotificationStore implements NotificationStore {
  private readonly db: PostgresClient;
  constructor(db: PostgresClient) { this.db = db; }

  async register(event: SafeNotificationEvent, recipientRefs: readonly string[]) {
    const eventId = `notification-${sha256(event.logicalKey).slice(0, 32)}`;
    const references = recipientRefs.length ? [...new Set(recipientRefs)] : [CONFIGURATION_RECIPIENT];
    await withTransaction(this.db, async (transaction) => {
      await transaction`INSERT INTO candidate_notification_events (id,candidate_id,run_id,logical_key,type,safe_payload_json,created_at_utc) VALUES (${eventId},${event.candidateId},${event.runId},${event.logicalKey},${event.type},${JSON.stringify(event.safePayload)},${event.createdAtUtc}) ON CONFLICT (logical_key) DO NOTHING`;
      for (const reference of references) await transaction`INSERT INTO candidate_notification_deliveries (id,event_id,recipient_ref,state,attempts) VALUES (${deliveryId(event.logicalKey, reference)},${eventId},${reference},${reference === CONFIGURATION_RECIPIENT ? "WAITING_CONFIGURATION" : "PENDING"},0) ON CONFLICT (event_id,recipient_ref) DO NOTHING`;
    });
    return this.byEvent(eventId);
  }

  async due(nowUtc: string, limit = 50) {
    const rows = await this.db<Record<string, unknown>[]>`SELECT d.id,d.event_id,d.recipient_ref,d.state,d.attempts,d.provider_message_id,d.next_attempt_at_utc,e.logical_key,e.safe_payload_json
      FROM candidate_notification_deliveries d JOIN candidate_notification_events e ON e.id=d.event_id WHERE d.state='PENDING' AND (d.next_attempt_at_utc IS NULL OR d.next_attempt_at_utc<=${nowUtc}) ORDER BY e.created_at_utc,d.id LIMIT ${limit}`;
    return rows.map(delivery);
  }

  async claim(id: string, nowUtc: string) {
    const rows = await this.db`UPDATE candidate_notification_deliveries SET state='SENDING',attempts=attempts+1,next_attempt_at_utc=${nowUtc} WHERE id=${id} AND state='PENDING' AND (next_attempt_at_utc IS NULL OR next_attempt_at_utc<=${nowUtc}) RETURNING id`;
    return rows.length === 1 ? this.byId(id) : null;
  }

  async sent(id: string, messageId: string) { await this.db`UPDATE candidate_notification_deliveries SET state='SENT',provider_message_id=${messageId},next_attempt_at_utc=NULL WHERE id=${id} AND state='SENDING'`; }
  async retry(id: string, nextAttemptAtUtc: string) { await this.db`UPDATE candidate_notification_deliveries SET state='PENDING',next_attempt_at_utc=${nextAttemptAtUtc} WHERE id=${id} AND state='SENDING'`; }
  async unknown(id: string, reconcileAtUtc: string) { await this.db`UPDATE candidate_notification_deliveries SET state='SENDING',next_attempt_at_utc=${reconcileAtUtc} WHERE id=${id} AND state='SENDING'`; }
  async failed(id: string) { await this.db`UPDATE candidate_notification_deliveries SET state='FAILED',next_attempt_at_utc=NULL WHERE id=${id} AND state='SENDING'`; }
  async reconcileUnknown(nowUtc: string) {
    const rows = await this.db`UPDATE candidate_notification_deliveries SET state='FAILED',next_attempt_at_utc=NULL WHERE state='SENDING' AND next_attempt_at_utc<=${nowUtc} RETURNING id`; return rows.length;
  }
  async manualRetry(id: string, recipientConfigured: boolean) {
    const next = recipientConfigured ? "PENDING" : "WAITING_CONFIGURATION";
    const rows = await this.db`UPDATE candidate_notification_deliveries SET state=${next},attempts=0,next_attempt_at_utc=NULL WHERE id=${id} AND state IN ('FAILED','WAITING_CONFIGURATION') RETURNING id`; return rows.length === 1;
  }

  private async byEvent(eventId: string) {
    const rows = await this.db<Record<string, unknown>[]>`SELECT d.id,d.event_id,d.recipient_ref,d.state,d.attempts,d.provider_message_id,d.next_attempt_at_utc,e.logical_key,e.safe_payload_json FROM candidate_notification_deliveries d JOIN candidate_notification_events e ON e.id=d.event_id WHERE d.event_id=${eventId} ORDER BY d.id`; return rows.map(delivery);
  }
  private async byId(id: string) {
    const rows = await this.db<Record<string, unknown>[]>`SELECT d.id,d.event_id,d.recipient_ref,d.state,d.attempts,d.provider_message_id,d.next_attempt_at_utc,e.logical_key,e.safe_payload_json FROM candidate_notification_deliveries d JOIN candidate_notification_events e ON e.id=d.event_id WHERE d.id=${id}`; return rows[0] ? delivery(rows[0]) : null;
  }
}

export type TelegramSendResult = { kind: "sent"; messageId: string } | { kind: "retryable" } | { kind: "permanent" } | { kind: "unknown" };

export class TelegramBotTransport {
  constructor(private readonly options: { token?: string; fetch?: typeof fetch; timeoutMs?: number }) {}
  async send(chatId: string, text: string): Promise<TelegramSendResult> {
    if (!this.options.token?.trim()) return { kind: "permanent" };
    try {
      const response = await (this.options.fetch ?? fetch)(`https://api.telegram.org/bot${this.options.token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }), signal: AbortSignal.timeout(this.options.timeoutMs ?? 60_000) });
      if (response.status === 429 || response.status >= 500) return { kind: "retryable" };
      if (!response.ok) return { kind: "permanent" };
      const body = await response.json() as { ok?: boolean; result?: { message_id?: number } };
      return body.ok !== false && body.result?.message_id !== undefined ? { kind: "sent", messageId: String(body.result.message_id) } : { kind: "unknown" };
    } catch { return { kind: "unknown" }; }
  }
}

export class NotificationDispatcher {
  constructor(private readonly store: NotificationStore, private readonly recipients: ServerRecipientRegistry, private readonly transport: TelegramBotTransport, private readonly render: (payload: Record<string, string>) => string) {}

  async dispatch(now = new Date()) {
    const results: DurableDelivery[] = [];
    for (const due of await this.store.due(now.toISOString())) {
      const chatId = this.recipients.resolve(due.recipientRef);
      if (!chatId) continue;
      const claimed = await this.store.claim(due.id, now.toISOString());
      if (!claimed) continue;
      const result = await this.transport.send(chatId, this.render(claimed.safePayload));
      if (result.kind === "sent") await this.store.sent(claimed.id, result.messageId);
      else if (result.kind === "retryable" && claimed.attempts < 3) await this.store.retry(claimed.id, new Date(now.getTime() + BACKOFF_MS[claimed.attempts - 1]).toISOString());
      else if (result.kind === "unknown") await this.store.unknown(claimed.id, new Date(now.getTime() + BACKOFF_MS[Math.min(claimed.attempts - 1, BACKOFF_MS.length - 1)]).toISOString());
      else await this.store.failed(claimed.id);
      results.push(claimed);
    }
    return results;
  }
}

export function readyLogicalKey(candidateId: number, analysisVersion: number) { return `candidate-ready:${candidateId}:v${String(analysisVersion).padStart(4, "0")}`; }
export function failedLogicalKey(candidateId: number, runId: string) { return `candidate-failed:${candidateId}:${runId}`; }
export function notificationDeliveryId(logicalKey: string, recipientRef: string) { return deliveryId(logicalKey, recipientRef); }

function deliveryId(logicalKey: string, recipientRef: string) { return `delivery-${sha256(`${logicalKey}:${recipientRef}`).slice(0, 32)}`; }
function delivery(row: Record<string, unknown>): DurableDelivery {
  return { id: String(row.id), eventId: String(row.event_id), logicalKey: String(row.logical_key), recipientRef: String(row.recipient_ref), state: String(row.state) as DeliveryState, attempts: Number(row.attempts), providerMessageId: row.provider_message_id ? String(row.provider_message_id) : undefined, nextAttemptAtUtc: row.next_attempt_at_utc ? String(row.next_attempt_at_utc) : undefined, safePayload: JSON.parse(String(row.safe_payload_json)) as Record<string, string> };
}
