import { authService, requestUsesSecureCookie } from "../../../../server/auth/request-principal.ts";
import { GENERIC_LOGIN_ERROR, cookieHeaders, safeReturnPath } from "../../../../server/auth/service.ts";

const privateHeaders = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: unknown; password?: unknown; remember?: unknown; returnPath?: unknown };
    if (typeof body.email !== "string" || typeof body.password !== "string") throw new Error("AUTH_LOGIN_REJECTED");
    const source = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || "direct";
    const result = await (await authService()).login({ email: body.email, password: body.password, remember: body.remember === true, source });
    const headers = new Headers(privateHeaders); for (const cookie of cookieHeaders({ ...result, secure: requestUsesSecureCookie(request) })) headers.append("set-cookie", cookie);
    return Response.json({ user: result.user, scope: result.scope, returnPath: safeReturnPath(body.returnPath) }, { headers });
  } catch {
    return Response.json({ error: GENERIC_LOGIN_ERROR }, { status: 401, headers: privateHeaders });
  }
}
