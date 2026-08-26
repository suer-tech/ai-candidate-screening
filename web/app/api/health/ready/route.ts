import { randomUUID } from "node:crypto";
import { serverContainer } from "../../../../server/configuration/container.ts";
import { loadGoogleOAuthConfiguration } from "../../../../server/google-drive-oauth/configuration.ts";
import { connectionTokenAad, decryptSecret, parseGoogleOAuthKeyring } from "../../../../server/google-drive-oauth/crypto.ts";
import { PostgresGoogleDriveOAuthRepository } from "../../../../server/google-drive-oauth/postgres-repository.ts";
import { LLM_CAPABILITIES } from "../../../../server/llm/configuration.ts";
import { loadRuntimeConfiguration as validateLlmRuntime } from "../../../../server/llm/runtime-loader.ts";
import { PostgresBlobStore } from "../../../../server/storage/blob-store.ts";
import { assertMigrationsCurrent } from "../../../../server/storage/migrations.ts";
import { probePostgres } from "../../../../server/storage/postgres.ts";

const HEADERS = { "cache-control": "no-store" };
type Check = { name: "postgresql" | "blob" | "oauth-config" | "oauth-envelope" | "llm" | "stt"; ready: boolean; code: string };

function safeCode(error: unknown, fallback: string) {
  return error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message) ? error.message : fallback;
}

async function check(name: Check["name"], operation: () => Promise<void> | void): Promise<Check> {
  try { await operation(); return { name, ready: true, code: "READY" }; }
  catch (error) { return { name, ready: false, code: safeCode(error, "CHECK_FAILED") }; }
}

export async function GET() {
  try {
    const container = await serverContainer();
    const blobs = new PostgresBlobStore(container.sql);
    const oauth = new PostgresGoogleDriveOAuthRepository(container.sql);
    const checks = await Promise.all([
      check("postgresql", async () => { await probePostgres(container.sql); await assertMigrationsCurrent(container.sql); }),
      check("blob", async () => {
        const scope = `readiness:${randomUUID()}`;
        try { await blobs.put({ scope, kind: "readiness", mimeType: "application/octet-stream", bytes: new Uint8Array([1]) }); }
        finally { await blobs.deleteScope(scope, true); }
      }),
      check("oauth-config", () => { loadGoogleOAuthConfiguration(container.environment); }),
      check("oauth-envelope", async () => {
        const connection = await oauth.getConnection();
        if (!connection || connection.state !== "CONNECTED" || !connection.refreshTokenEnvelope) throw new Error("GOOGLE_DRIVE_REAUTH_REQUIRED");
        const keyring = parseGoogleOAuthKeyring(container.environment.GOOGLE_OAUTH_TOKEN_KEYRING_JSON);
        await decryptSecret(connection.refreshTokenEnvelope, connectionTokenAad({ id: connection.id, ownerSubject: connection.ownerSubject,
          scopes: connection.scopes, keyVersion: connection.refreshTokenEnvelope.keyVersion }), keyring);
      }),
      check("llm", () => { validateLlmRuntime(container.environment, LLM_CAPABILITIES); }),
      check("stt", () => { if (!container.environment.ASSEMBLYAI_API_KEY) throw new Error("ASSEMBLYAI_API_KEY_MISSING"); }),
    ]);
    const ready = checks.every((item) => item.ready);
    return Response.json({ ready, runtime: "node", storage: "postgresql", checks }, { status: ready ? 200 : 503, headers: HEADERS });
  } catch { return Response.json({ ready: false, runtime: "node", storage: "postgresql", error: "READINESS_INFRASTRUCTURE_UNAVAILABLE" }, { status: 503, headers: HEADERS }); }
}
