import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { PostgresClient } from "../storage/postgres.ts";
import { withTransaction } from "../storage/postgres.ts";
import { canonicalizeEmail, hashPassword, runDummyPasswordVerification, validatePassword, verifyPassword } from "./password.ts";

export const SESSION_COOKIE = "__Host-hh_session";
export const LOCAL_SESSION_COOKIE = "hh_session";
export const CSRF_COOKIE = "hh_csrf";
export const GENERIC_LOGIN_ERROR = "Не удалось войти. Проверьте данные";
export const DEFAULT_TTL_SECONDS = 43_200;
export const REMEMBER_TTL_SECONDS = 2_592_000;
const WINDOW_MS = 900_000;
const FAILURE_LIMIT = 5;

type AuthUserRow = { id: string; canonical_email: string; display_name: string; password_hash: string; state: "ACTIVE" | "DISABLED"; must_change_password: boolean };
type SessionRow = { id: string; user_id: string; display_name: string; canonical_email: string; state: "ACTIVE" | "DISABLED"; must_change_password: boolean; csrf_hash: string; scope: "FULL" | "PASSWORD_CHANGE_ONLY"; expires_at: string; revoked_at: string | null };
export type AuthPrincipal = { id: string; email: string; displayName: string; role: "HR-владелец вакансии"; scope: "FULL" | "PASSWORD_CHANGE_ONLY"; sessionId: string; csrfHash: string };

function iso(ms: number) { return new Date(ms).toISOString(); }
function sha(value: string) { return createHash("sha256").update(value).digest("hex"); }
function opaqueToken() { return randomBytes(32).toString("base64url"); }
function safeEqual(left: string, right: string) { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
export function safeReturnPath(value: unknown) { return typeof value === "string" && /^\/(?!\/)[\w\-./?=&%]*$/.test(value) ? value : "/"; }
export function parseCookies(request: Request) { return Object.fromEntries((request.headers.get("cookie") ?? "").split(";").map((part) => part.trim()).filter(Boolean).map((part) => { const at = part.indexOf("="); return [decodeURIComponent(part.slice(0, at)), decodeURIComponent(part.slice(at + 1))]; })); }

export class AuthService {
  private readonly sql: PostgresClient;
  private readonly fingerprintKey: string;
  private readonly now: () => number;
  private readonly publicOrigin?: string;

  constructor(sql: PostgresClient, fingerprintKey: string, now = () => Date.now(), publicOrigin?: string) {
    this.sql = sql;
    this.fingerprintKey = fingerprintKey;
    this.now = now;
    this.publicOrigin = publicOrigin ? new URL(publicOrigin).origin : undefined;
  }

  private fingerprint(kind: string, value: string) { return createHmac("sha256", this.fingerprintKey).update(`${kind}:${value}`).digest("hex"); }
  private async audit(sql: PostgresClient, eventType: string, safeCode: string, actorId?: string | null, targetId?: string | null) {
    await sql`INSERT INTO auth_security_events (id,event_type,actor_id,target_id,safe_code,occurred_at) VALUES (${randomUUID()},${eventType},${actorId ?? null},${targetId ?? null},${safeCode},${iso(this.now())})`;
  }

  async createUser(input: { email: string; displayName: string; password: string }) {
    const email = canonicalizeEmail(input.email); validatePassword(input.password);
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("AUTH_EMAIL_INVALID");
    const passwordHash = await hashPassword(input.password); const now = iso(this.now()); const id = randomUUID();
    await withTransaction(this.sql, async (tx) => {
      await tx`INSERT INTO auth_users (id,canonical_email,display_name,role,password_hash,state,must_change_password,created_at,updated_at) VALUES (${id},${email},${input.displayName.trim()},${"HR-владелец вакансии"},${passwordHash},${"ACTIVE"},${true},${now},${now})`;
      await this.audit(tx, "USER_CREATED", "AUTH_USER_CREATED", null, id);
    });
    return { id, email, displayName: input.displayName.trim(), mustChangePassword: true };
  }

  async login(input: { email: string; password: string; source: string; remember: boolean }) {
    const email = canonicalizeEmail(input.email); const now = this.now(); const emailFp = this.fingerprint("email", email); const sourceFp = this.fingerprint("source", input.source);
    const recent = await this.sql<{ count: number; blocked_until: string | null }[]>`SELECT count(*)::integer AS count, max(blocked_until) AS blocked_until FROM auth_login_attempts WHERE email_fingerprint=${emailFp} AND source_fingerprint=${sourceFp} AND attempted_at >= ${iso(now - WINDOW_MS)}`;
    const blocked = recent[0]?.blocked_until && Date.parse(recent[0].blocked_until) > now;
    const users = await this.sql<AuthUserRow[]>`SELECT id,canonical_email,display_name,password_hash,state,must_change_password FROM auth_users WHERE canonical_email=${email} LIMIT 1`;
    const user = users[0];
    const passwordAccepted = blocked ? false : user ? await verifyPassword(input.password, user.password_hash) : (await runDummyPasswordVerification(input.password), false);
    if (blocked || !user || user.state !== "ACTIVE" || !passwordAccepted) {
      const nextCount = Number(recent[0]?.count ?? 0) + 1; const blockUntil = nextCount >= FAILURE_LIMIT ? iso(now + WINDOW_MS) : null;
      await withTransaction(this.sql, async (tx) => {
        await tx`INSERT INTO auth_login_attempts (id,email_fingerprint,source_fingerprint,attempted_at,blocked_until) VALUES (${randomUUID()},${emailFp},${sourceFp},${iso(now)},${blockUntil})`;
        await this.audit(tx, blocked || blockUntil ? "LOGIN_BLOCKED" : "LOGIN_FAILURE", "AUTH_LOGIN_REJECTED", null, user?.id ?? null);
      });
      throw new Error("AUTH_LOGIN_REJECTED");
    }
    const scope = user.must_change_password ? "PASSWORD_CHANGE_ONLY" : "FULL";
    const session = await this.issueSession(user.id, scope, input.remember);
    await withTransaction(this.sql, async (tx) => { await tx`DELETE FROM auth_login_attempts WHERE email_fingerprint=${emailFp} AND source_fingerprint=${sourceFp}`; await this.audit(tx, "LOGIN_SUCCESS", "AUTH_LOGIN_ACCEPTED", user.id, user.id); });
    return { user: { id: user.id, email: user.canonical_email, displayName: user.display_name, role: "HR-владелец вакансии" as const, mustChangePassword: user.must_change_password }, ...session };
  }

  private async issueSession(userId: string, scope: "FULL" | "PASSWORD_CHANGE_ONLY", remember: boolean) {
    const token = opaqueToken(); const csrf = opaqueToken(); const id = randomUUID(); const now = this.now(); const ttlSeconds = remember ? REMEMBER_TTL_SECONDS : DEFAULT_TTL_SECONDS;
    await this.sql`INSERT INTO auth_sessions (id,user_id,token_hash,csrf_hash,scope,created_at,expires_at) VALUES (${id},${userId},${sha(token)},${sha(csrf)},${scope},${iso(now)},${iso(now + ttlSeconds * 1000)})`;
    return { token, csrf, expiresAt: iso(now + ttlSeconds * 1000), ttlSeconds, scope };
  }

  async authenticate(token: string | undefined): Promise<AuthPrincipal | null> {
    if (!token) return null;
    const rows = await this.sql<SessionRow[]>`SELECT s.id,s.user_id,u.display_name,u.canonical_email,u.state,u.must_change_password,s.csrf_hash,s.scope,s.expires_at,s.revoked_at FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.token_hash=${sha(token)} LIMIT 1`;
    const row = rows[0]; if (!row || row.revoked_at || row.state !== "ACTIVE" || Date.parse(row.expires_at) <= this.now()) return null;
    return { id: row.user_id, email: row.canonical_email, displayName: row.display_name, role: "HR-владелец вакансии", scope: row.scope, sessionId: row.id, csrfHash: row.csrf_hash };
  }

  async logout(principal: AuthPrincipal) { await withTransaction(this.sql, async (tx) => { await tx`UPDATE auth_sessions SET revoked_at=${iso(this.now())},revoke_reason=${"LOGOUT"} WHERE id=${principal.sessionId} AND revoked_at IS NULL`; await this.audit(tx, "LOGOUT", "AUTH_LOGOUT", principal.id, principal.id); }); }
  async changePassword(principal: AuthPrincipal, currentPassword: string | undefined, newPassword: string, remember: boolean) {
    validatePassword(newPassword); const users = await this.sql<AuthUserRow[]>`SELECT id,canonical_email,display_name,password_hash,state,must_change_password FROM auth_users WHERE id=${principal.id} LIMIT 1`; const user = users[0];
    const forcedChangeSession = principal.scope === "PASSWORD_CHANGE_ONLY" && user?.must_change_password === true;
    const currentPasswordAccepted = forcedChangeSession || (typeof currentPassword === "string" && await verifyPassword(currentPassword, user?.password_hash ?? ""));
    if (!user || user.state !== "ACTIVE" || !currentPasswordAccepted) throw new Error("AUTH_PASSWORD_CHANGE_REJECTED");
    const passwordHash = await hashPassword(newPassword);
    await withTransaction(this.sql, async (tx) => { await tx`UPDATE auth_users SET password_hash=${passwordHash},must_change_password=false,updated_at=${iso(this.now())} WHERE id=${principal.id}`; await tx`UPDATE auth_sessions SET revoked_at=${iso(this.now())},revoke_reason=${"PASSWORD_CHANGED"} WHERE user_id=${principal.id} AND revoked_at IS NULL`; await this.audit(tx, "PASSWORD_CHANGED", "AUTH_PASSWORD_CHANGED", principal.id, principal.id); });
    return this.issueSession(principal.id, "FULL", remember);
  }
  async setUserState(userId: string, state: "ACTIVE" | "DISABLED") { await withTransaction(this.sql, async (tx) => { await tx`UPDATE auth_users SET state=${state},updated_at=${iso(this.now())} WHERE id=${userId}`; if (state === "DISABLED") await tx`UPDATE auth_sessions SET revoked_at=${iso(this.now())},revoke_reason=${"USER_DISABLED"} WHERE user_id=${userId} AND revoked_at IS NULL`; await this.audit(tx, state === "DISABLED" ? "USER_DISABLED" : "USER_ENABLED", `AUTH_USER_${state}`, null, userId); }); }
  async revokeSessions(userId: string) { await withTransaction(this.sql, async (tx) => { await tx`UPDATE auth_sessions SET revoked_at=${iso(this.now())},revoke_reason=${"OPERATOR_REVOKE"} WHERE user_id=${userId} AND revoked_at IS NULL`; await this.audit(tx, "SESSIONS_REVOKED", "AUTH_SESSIONS_REVOKED", null, userId); }); }
  async resetPassword(userId: string, password: string) { validatePassword(password); const passwordHash = await hashPassword(password); await withTransaction(this.sql, async (tx) => { await tx`UPDATE auth_users SET password_hash=${passwordHash},must_change_password=true,updated_at=${iso(this.now())} WHERE id=${userId}`; await tx`UPDATE auth_sessions SET revoked_at=${iso(this.now())},revoke_reason=${"PASSWORD_RESET"} WHERE user_id=${userId} AND revoked_at IS NULL`; await this.audit(tx, "PASSWORD_RESET", "AUTH_PASSWORD_RESET", null, userId); }); }
  async verifyCsrf(request: Request, principal: AuthPrincipal) { const cookies = parseCookies(request); const proof = request.headers.get("x-csrf-token") ?? ""; const origin = request.headers.get("origin"); const expectedOrigin = this.publicOrigin ?? new URL(request.url).origin; return origin === expectedOrigin && proof.length > 20 && cookies[CSRF_COOKIE] === proof && safeEqual(sha(proof), principal.csrfHash); }
  async cleanup() { const now = iso(this.now()); const attemptsBefore = iso(this.now() - 2 * 24 * 60 * 60 * 1000); const eventsBefore = iso(this.now() - 180 * 24 * 60 * 60 * 1000); await this.sql`DELETE FROM auth_login_attempts WHERE attempted_at < ${attemptsBefore}`; await this.sql`DELETE FROM auth_sessions WHERE expires_at < ${now} OR (revoked_at IS NOT NULL AND revoked_at < ${attemptsBefore})`; await this.sql`DELETE FROM auth_security_events WHERE occurred_at < ${eventsBefore}`; }
}

export function cookieHeaders(input: { token: string; csrf: string; ttlSeconds: number; secure: boolean }) {
  const sessionName = input.secure ? SESSION_COOKIE : LOCAL_SESSION_COOKIE; const secure = input.secure ? "; Secure" : "";
  return [`${sessionName}=${encodeURIComponent(input.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${input.ttlSeconds}${secure}`, `${CSRF_COOKIE}=${encodeURIComponent(input.csrf)}; Path=/; SameSite=Lax; Max-Age=${input.ttlSeconds}${secure}`];
}
export function clearCookieHeaders(secure: boolean) { const name = secure ? SESSION_COOKIE : LOCAL_SESSION_COOKIE; const suffix = secure ? "; Secure" : ""; return [`${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${suffix}`, `${CSRF_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0${suffix}`]; }
