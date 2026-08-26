import { requestPrincipal } from "../../../../../../server/auth/request-principal.ts";
import { googleDriveOAuthRuntime } from "../../../../../../server/google-drive-oauth/runtime-binding.ts";
import { GoogleDriveOAuthError } from "../../../../../../server/google-drive-oauth/types.ts";

const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };

export async function POST(request: Request) {
  const principalId = await requestPrincipal(request);
  if (!principalId) return Response.json({ error: "GOOGLE_OAUTH_AUTHENTICATION_REQUIRED" }, { status: 401, headers });
  try {
    const body = await request.json().catch(() => ({})) as { returnPath?: string };
    const runtime = await googleDriveOAuthRuntime();
    return Response.json(await runtime.service.start(principalId, body.returnPath ?? "/"), { status: 201, headers });
  } catch (error) {
    const code = error instanceof GoogleDriveOAuthError ? error.code : "GOOGLE_OAUTH_CONNECT_FAILED";
    return Response.json({ error: code }, { status: code.endsWith("_MISSING") ? 503 : 422, headers });
  }
}
