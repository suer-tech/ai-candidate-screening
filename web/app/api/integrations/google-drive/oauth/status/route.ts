import { requestPrincipal } from "../../../../../../server/auth/request-principal.ts";
import { googleDriveOAuthRuntime } from "../../../../../../server/google-drive-oauth/runtime-binding.ts";
import { GoogleDriveOAuthError } from "../../../../../../server/google-drive-oauth/types.ts";

const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };

export async function GET(request: Request) {
  if (!await requestPrincipal(request)) return Response.json({ state: "DISCONNECTED", connected: false }, { status: 401, headers });
  try {
    const runtime = await googleDriveOAuthRuntime();
    return Response.json(await runtime.status(), { headers });
  } catch (error) {
    const code = error instanceof GoogleDriveOAuthError ? error.code : "GOOGLE_OAUTH_STATUS_UNAVAILABLE";
    return Response.json({ state: "MISCONFIGURED", connected: false, nextAction: "Настроить Google Drive OAuth", error: code }, { status: 503, headers });
  }
}
