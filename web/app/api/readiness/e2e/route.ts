import { serverContainer } from "../../../../server/configuration/container.ts";
import { loadRuntimeConfiguration as validateLlmRuntime } from "../../../../server/llm/runtime-loader.ts";
import { evaluateProductionReadiness } from "../../../../server/readiness/e2e-preflight.ts";
import { PostgresBlobStore } from "../../../../server/storage/blob-store.ts";

const PRIVATE_HEADERS = { "cache-control": "private, no-store" };
function equalSecret(actual: string | null, expected: unknown) {
  if (typeof expected !== "string" || !expected || actual === null || actual.length !== expected.length) return false;
  let difference = 0; for (let index = 0; index < actual.length; index += 1) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index); return difference === 0;
}
export async function GET(request: Request) {
  const identity = request.headers.get("oai-authenticated-user-id");
  if (!identity) return Response.json({ ready: false, error: "HR_IDENTITY_MISSING" }, { status: 401, headers: PRIVATE_HEADERS });
  try {
    const container = await serverContainer();
    if (!equalSecret(request.headers.get("x-e2e-preflight-token"), container.environment.E2E_PREFLIGHT_TOKEN)) return Response.json({ ready: false, error: "PREFLIGHT_ACCESS_DENIED" }, { status: 403, headers: PRIVATE_HEADERS });
    const readiness = await evaluateProductionReadiness({
      identity, database: container.sql, blobs: new PostgresBlobStore(container.sql), environment: container.environment,
      async driveProbe() {
        const rows = await container.sql`SELECT id FROM google_drive_oauth_connections WHERE singleton_key='primary' AND state='CONNECTED' AND token_ciphertext IS NOT NULL LIMIT 1`;
        if (rows.length !== 1) throw new Error("GOOGLE_DRIVE_REAUTH_REQUIRED");
      },
      validateLlm(environment, capabilities) { validateLlmRuntime(environment, capabilities); },
    });
    return Response.json(readiness, { status: readiness.ready ? 200 : 503, headers: PRIVATE_HEADERS });
  } catch { return Response.json({ ready: false, error: "PREFLIGHT_INFRASTRUCTURE_UNAVAILABLE" }, { status: 503, headers: PRIVATE_HEADERS }); }
}
