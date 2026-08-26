import { requestPrincipal } from "../../../../../../server/auth/request-principal.ts";
import { googleDriveOAuthRuntime } from "../../../../../../server/google-drive-oauth/runtime-binding.ts";
import { GoogleDriveOAuthError } from "../../../../../../server/google-drive-oauth/types.ts";

const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };

export async function POST(request: Request) {
  const principalId = await requestPrincipal(request);
  if (!principalId) return Response.json({ error: "GOOGLE_OAUTH_AUTHENTICATION_REQUIRED" }, { status: 401, headers });
  try {
    const body = await request.json().catch(() => ({})) as { confirm?: boolean };
    if (body.confirm !== true) return Response.json({ error: "GOOGLE_OAUTH_DISCONNECT_CONFIRMATION_REQUIRED" }, { status: 422, headers });
    const runtime = await googleDriveOAuthRuntime();
    return Response.json(await runtime.service.disconnect(principalId), { headers });
  } catch (error) {
    const code = error instanceof GoogleDriveOAuthError ? error.code : "GOOGLE_OAUTH_DISCONNECT_FAILED";
    return Response.json({ error: code }, { status: 503, headers });
  }
}
