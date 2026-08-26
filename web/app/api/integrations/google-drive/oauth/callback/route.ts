import { requestPrincipal } from "../../../../../../server/auth/request-principal.ts";
import { googleDriveOAuthRuntime } from "../../../../../../server/google-drive-oauth/runtime-binding.ts";
import { GoogleDriveOAuthError } from "../../../../../../server/google-drive-oauth/types.ts";

const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };

export async function GET(request: Request) {
  const principalId = await requestPrincipal(request);
  if (!principalId) return Response.json({ error: "GOOGLE_OAUTH_AUTHENTICATION_REQUIRED" }, { status: 401, headers });
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (url.searchParams.has("error")) return Response.redirect(new URL("/?googleDrive=cancelled", url.origin), 303);
  try {
    const runtime = await googleDriveOAuthRuntime();
    const result = await runtime.service.callback({ principalId, state, code });
    const destination = new URL(result.returnPath, url.origin);
    destination.searchParams.set("googleDrive", "connected");
    return Response.redirect(destination, 303);
  } catch (error) {
    const codeValue = error instanceof GoogleDriveOAuthError ? error.code : "GOOGLE_OAUTH_CALLBACK_FAILED";
    const destination = new URL("/", url.origin);
    destination.searchParams.set("googleDrive", "error");
    destination.searchParams.set("code", codeValue);
    return Response.redirect(destination, 303);
  }
}
