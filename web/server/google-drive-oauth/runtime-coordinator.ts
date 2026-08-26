import { GoogleDriveOAuthError, type GoogleDriveOAuthConnection } from "./types.ts";

export class GoogleDriveRuntimeCoordinator {
  private readonly runtime: {
    waitForHuman(input: { taskId: string; attemptId: string; worker: string; leaseToken: number; obstacle: string; action: string; now: number }): Promise<unknown>;
    resumeGoogleDriveRuns(input: { connectionId: string; ownerSubject: string; now: number }): Promise<{ resumedRunIds: string[] }>;
  };

  constructor(runtime: GoogleDriveRuntimeCoordinator["runtime"]) { this.runtime = runtime; }

  async handleExecutionError(error: unknown, task: { taskId: string; attemptId: string; worker: string; leaseToken: number }, now = Date.now()) {
    const code = error instanceof GoogleDriveOAuthError ? error.code : error instanceof Error ? error.message : "GOOGLE_DRIVE_EXECUTION_FAILED";
    if (code !== "GOOGLE_OAUTH_INVALID_GRANT" && code !== "GOOGLE_DRIVE_REAUTH_REQUIRED") throw error;
    await this.runtime.waitForHuman({ ...task, obstacle: "GOOGLE_OAUTH_INVALID_GRANT", action: "Переподключить Google Drive", now });
    return { outcome: "WAITING_FOR_HUMAN" as const, obstacle: "GOOGLE_OAUTH_INVALID_GRANT", action: "Переподключить Google Drive" };
  }

  async reconnect(connection: Pick<GoogleDriveOAuthConnection, "id" | "ownerSubject">, now = Date.now()) {
    return this.runtime.resumeGoogleDriveRuns({ connectionId: connection.id, ownerSubject: connection.ownerSubject, now });
  }

  async reconcileBeforeRetry<T>(input: { reconcile(): Promise<{ state: "CONFIRMED" | "ABSENT" | "UNKNOWN"; value?: T }>;
    retryOrReuse(reconciled: { state: "CONFIRMED" | "ABSENT" | "UNKNOWN"; value?: T }): Promise<T> }) {
    const reconciled = await input.reconcile();
    if (reconciled.state === "UNKNOWN") throw new GoogleDriveOAuthError("GOOGLE_DRIVE_OUTCOME_STILL_UNKNOWN", true);
    return input.retryOrReuse(reconciled);
  }
}
