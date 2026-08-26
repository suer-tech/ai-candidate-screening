import { createHash } from "node:crypto";
import { requestPrincipal } from "../../../../../server/auth/request-principal.ts";
import { serverContainer } from "../../../../../server/configuration/container.ts";
import { createGoogleDriveOAuthRuntime } from "../../../../../server/google-drive-oauth/runtime.ts";

const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };

function equalSecret(actual: string, expected: unknown) {
  if (typeof expected !== "string" || !expected || actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

export async function POST(request: Request) {
  if (!await requestPrincipal(request)) return Response.json({ ready: false, code: "HR_IDENTITY_MISSING" }, { status: 401, headers });
  const container = await serverContainer();
  const env = container.environment;
  if (env.E2E_ENVIRONMENT !== "local") return Response.json({ ready: false, code: "LOCAL_SMOKE_ONLY" }, { status: 403, headers });
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!equalSecret(supplied, env.AGENT_RUNTIME_INTERNAL_TOKEN)) return Response.json({ ready: false, code: "LOCAL_SMOKE_UNAUTHORIZED" }, { status: 401, headers });
  const firstRuntime = createGoogleDriveOAuthRuntime({ database: container.sql, environment: env });
  const readiness = await firstRuntime.readiness();
  if (!readiness.ready) return Response.json({ ready: false, code: readiness.checks.find((check) => !check.ready)?.code ?? "GOOGLE_DRIVE_NOT_READY", checks: readiness.checks }, { status: 503, headers });

  const runtimeAfterRestart = createGoogleDriveOAuthRuntime({ database: container.sql, environment: env });
  const connection = await runtimeAfterRestart.repository.getConnection();
  if (!connection) return Response.json({ ready: false, code: "GOOGLE_DRIVE_ACTIVE_OWNER_MISSING" }, { status: 503, headers });
  const drive = await runtimeAfterRestart.drive();
  const nonce = crypto.randomUUID();
  const folderIdentity = `local-drive-smoke:${nonce}:folder`;
  const pdfIdentity = `local-drive-smoke:${nonce}:pdf`;
  let folderId: string | undefined;
  let pdfId: string | undefined;
  try {
    const folder = await drive.ensureFolder({ name: `.hh-local-smoke-${nonce.slice(0, 8)}`, parentFolderId: connection.rootFolderId, operationIdentity: folderIdentity });
    folderId = folder.id;
    const bytes = new TextEncoder().encode("%PDF-1.4\n% synthetic local OAuth smoke\n%%EOF\n");
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const published = await drive.publishPdf({ parentFolderId: folder.id, fileName: "oauth-smoke.pdf", bytes, checksum, operationIdentity: pdfIdentity });
    pdfId = published.id;
    const reconciled = await drive.publishPdf({ parentFolderId: folder.id, fileName: "oauth-smoke.pdf", bytes, checksum, operationIdentity: pdfIdentity });
    const downloaded = await drive.downloadFile(published.id);
    const downloadedChecksum = createHash("sha256").update(downloaded).digest("hex");
    if (reconciled.id !== published.id || !reconciled.reused || downloadedChecksum !== checksum) throw new Error("GOOGLE_DRIVE_SMOKE_RECONCILE_OR_READ_FAILED");
    await drive.removeCreatedObject({ fileId: published.id, operationIdentity: pdfIdentity });
    pdfId = undefined;
    await drive.removeCreatedObject({ fileId: folder.id, operationIdentity: folderIdentity });
    folderId = undefined;
    return Response.json({ ready: true, providerMode: "real", checks: {
      consentConnection: true, restartRefresh: true, rootRead: true, publish: true, reconcileReuse: true, downloadChecksum: true, cleanup: true,
    } }, { headers });
  } catch (error) {
    if (pdfId) await drive.removeCreatedObject({ fileId: pdfId, operationIdentity: pdfIdentity }).catch(() => undefined);
    if (folderId) await drive.removeCreatedObject({ fileId: folderId, operationIdentity: folderIdentity }).catch(() => undefined);
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "GOOGLE_DRIVE_LOCAL_SMOKE_FAILED";
    return Response.json({ ready: false, code }, { status: 503, headers });
  }
}
