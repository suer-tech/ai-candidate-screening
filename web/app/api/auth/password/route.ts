import { authService, requestAuthPrincipal, requestUsesSecureCookie } from "../../../../server/auth/request-principal.ts";
import { cookieHeaders } from "../../../../server/auth/service.ts";
export async function POST(request: Request) {
  const principal = await requestAuthPrincipal(request); if (!principal) return Response.json({ error: "Требуется авторизация" }, { status: 401 });
  const service = await authService(); if (principal.sessionId !== "local-e2e" && !await service.verifyCsrf(request, principal)) return Response.json({ error: "Недопустимое подтверждение запроса" }, { status: 403 });
  try {
    const body = await request.json() as { currentPassword?: unknown; newPassword?: unknown; remember?: unknown };
    if (typeof body.newPassword !== "string") throw new Error("AUTH_PASSWORD_CHANGE_REJECTED");
    const result = await service.changePassword(principal, body.currentPassword, body.newPassword, body.remember === true);
    const headers = new Headers({ "cache-control": "private, no-store" }); for (const cookie of cookieHeaders({ ...result, secure: requestUsesSecureCookie(request) })) headers.append("set-cookie", cookie);
    return Response.json({ changed: true, scope: "FULL" }, { headers });
  } catch { return Response.json({ error: "Не удалось изменить пароль" }, { status: 422 }); }
}
