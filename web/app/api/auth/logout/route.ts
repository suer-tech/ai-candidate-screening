import { authService, requestAuthPrincipal, requestUsesSecureCookie } from "../../../../server/auth/request-principal.ts";
import { clearCookieHeaders } from "../../../../server/auth/service.ts";
export async function POST(request: Request) {
  const principal = await requestAuthPrincipal(request); if (!principal) return Response.json({ error: "Требуется авторизация" }, { status: 401 });
  if (principal.sessionId !== "local-e2e" && principal.sessionId !== "sites") {
    if (!await (await authService()).verifyCsrf(request, principal)) return Response.json({ error: "Недопустимое подтверждение запроса" }, { status: 403 });
    await (await authService()).logout(principal);
  }
  const headers = new Headers({ "cache-control": "private, no-store" }); for (const cookie of clearCookieHeaders(requestUsesSecureCookie(request))) headers.append("set-cookie", cookie);
  return Response.json({ loggedOut: true }, { headers });
}
