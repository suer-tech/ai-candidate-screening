import { serverContainer } from "../configuration/container.ts";
import { AuthService, LOCAL_SESSION_COOKIE, SESSION_COOKIE, parseCookies, type AuthPrincipal } from "./service.ts";

export async function authService() {
  const container = await serverContainer();
  const fingerprintKey = container.environment.AUTH_FINGERPRINT_KEY || container.environment.AGENT_RUNTIME_INTERNAL_TOKEN;
  if (!fingerprintKey) throw new Error("AUTH_FINGERPRINT_KEY_MISSING");
  return new AuthService(container.sql, fingerprintKey);
}

export async function requestAuthPrincipal(request: Request): Promise<AuthPrincipal | null> {
  if (process.env.E2E_ENVIRONMENT === "local" && process.env.LOCAL_AUTH_USER_ID?.trim()) {
    return { id: process.env.LOCAL_AUTH_USER_ID.trim(), email: process.env.LOCAL_AUTH_USER_EMAIL?.trim() || "local@example.invalid", displayName: process.env.LOCAL_AUTH_USER_FULL_NAME?.trim() || "Local HR", role: "HR-владелец вакансии", scope: "FULL", sessionId: "local-e2e", csrfHash: "local-e2e" };
  }
  const cookies = parseCookies(request);
  return (await authService()).authenticate(cookies[SESSION_COOKIE] ?? cookies[LOCAL_SESSION_COOKIE]);
}

export async function requestPrincipal(request: Request) {
  const principal = await requestAuthPrincipal(request);
  if (principal?.scope !== "FULL") return null;
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase());
  if (mutation && principal.sessionId !== "local-e2e" && !await (await authService()).verifyCsrf(request, principal)) return null;
  return principal.id;
}
export async function requireFullPrincipal(request: Request) { const principal = await requestAuthPrincipal(request); return principal?.scope === "FULL" ? principal : null; }

export function requestUsesSecureCookie(request: Request) {
  const protocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim() || new URL(request.url).protocol.replace(":", "");
  return protocol === "https";
}
