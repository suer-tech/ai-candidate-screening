import { requestPrincipal } from "../../../../../server/auth/request-principal.ts";
import { googleDriveOAuthRuntime } from "../../../../../server/google-drive-oauth/runtime-binding.ts";

const PRIVATE_HEADERS = { "cache-control": "private, no-store" };

export async function GET(request: Request) {
  if (!await requestPrincipal(request)) {
    return Response.json({ state: "disconnected" }, { status: 401, headers: PRIVATE_HEADERS });
  }

  try {
    const readiness = await (await googleDriveOAuthRuntime()).readiness();
    return Response.json({
      connected: readiness.ready,
      providerMode: readiness.providerMode,
      permissions: readiness.permissions,
      checks: readiness.checks,
    }, { status: readiness.ready ? 200 : 503, headers: PRIVATE_HEADERS });
  } catch {
    return Response.json({ state: "disconnected" }, { status: 503, headers: PRIVATE_HEADERS });
  }
}
