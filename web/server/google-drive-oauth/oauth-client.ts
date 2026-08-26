import { GoogleDriveOAuthError, type GoogleOAuthRuntimeConfiguration } from "./types.ts";

type TokenResponse = { access_token?: string; expires_in?: number; refresh_token?: string; scope?: string; token_type?: string; error?: string };

async function json<T>(response: Response, fallbackCode: string): Promise<T> {
  let body: unknown;
  try { body = await response.json(); } catch { throw new GoogleDriveOAuthError(fallbackCode, response.status >= 500 || response.status === 429); }
  if (!response.ok) {
    const error = typeof body === "object" && body && "error" in body ? String((body as { error: unknown }).error) : fallbackCode;
    if (error === "invalid_grant") throw new GoogleDriveOAuthError("GOOGLE_OAUTH_INVALID_GRANT");
    throw new GoogleDriveOAuthError(fallbackCode, response.status >= 500 || response.status === 429);
  }
  return body as T;
}

export class GoogleOAuthClient {
  private readonly configuration: GoogleOAuthRuntimeConfiguration;
  private readonly fetcher: typeof fetch;

  constructor(configuration: GoogleOAuthRuntimeConfiguration, fetcher: typeof fetch = fetch) {
    this.configuration = configuration;
    this.fetcher = fetcher;
  }

  authorizationUrl(input: { state: string; codeChallenge: string }) {
    const url = new URL(this.configuration.authorizationEndpoint);
    url.search = new URLSearchParams({
      client_id: this.configuration.clientId,
      redirect_uri: this.configuration.redirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      scope: "openid email https://www.googleapis.com/auth/drive",
      state: input.state,
      code_challenge: input.codeChallenge,
      code_challenge_method: "S256",
    }).toString();
    return url.toString();
  }

  async exchangeCode(code: string, verifier: string) {
    const response = await this.fetcher(this.configuration.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: this.configuration.clientId, client_secret: this.configuration.clientSecret,
        redirect_uri: this.configuration.redirectUri, grant_type: "authorization_code", code_verifier: verifier }),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    const token = await json<TokenResponse>(response, "GOOGLE_OAUTH_CODE_EXCHANGE_FAILED");
    if (!token.access_token) throw new GoogleDriveOAuthError("GOOGLE_OAUTH_ACCESS_TOKEN_MISSING");
    if (!token.refresh_token) throw new GoogleDriveOAuthError("GOOGLE_OAUTH_REFRESH_TOKEN_MISSING");
    return { accessToken: token.access_token, refreshToken: token.refresh_token, expiresIn: Number(token.expires_in ?? 3600), scopes: token.scope?.split(/\s+/).filter(Boolean) ?? [] };
  }

  async refresh(refreshToken: string) {
    const response = await this.fetcher(this.configuration.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ refresh_token: refreshToken, client_id: this.configuration.clientId, client_secret: this.configuration.clientSecret, grant_type: "refresh_token" }),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    const token = await json<TokenResponse>(response, "GOOGLE_OAUTH_REFRESH_FAILED");
    if (!token.access_token) throw new GoogleDriveOAuthError("GOOGLE_OAUTH_ACCESS_TOKEN_MISSING");
    return { accessToken: token.access_token, refreshToken: token.refresh_token, expiresIn: Number(token.expires_in ?? 3600), scopes: token.scope?.split(/\s+/).filter(Boolean) ?? [] };
  }

  async identity(accessToken: string) {
    const response = await this.fetcher(this.configuration.userInfoEndpoint, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(30_000) });
    const identity = await json<{ sub?: string; email?: string; email_verified?: boolean }>(response, "GOOGLE_OAUTH_IDENTITY_FAILED");
    if (!identity.sub || !identity.email || identity.email_verified === false) throw new GoogleDriveOAuthError("GOOGLE_OAUTH_IDENTITY_INVALID");
    return { subject: identity.sub, email: identity.email };
  }

  async revoke(token: string) {
    const response = await this.fetcher(this.configuration.revokeEndpoint, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }), signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new GoogleDriveOAuthError("GOOGLE_OAUTH_REVOKE_FAILED", response.status >= 500 || response.status === 429);
  }
}
