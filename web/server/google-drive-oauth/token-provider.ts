import { connectionTokenAad, decryptSecret, encryptSecret, type GoogleOAuthKeyring } from "./crypto.ts";
import { GoogleOAuthClient } from "./oauth-client.ts";
import { GoogleDriveOAuthError, type GoogleDriveOAuthConnection, type GoogleDriveOAuthRepository, type GoogleOAuthRuntimeConfiguration } from "./types.ts";

type CachedToken = { token: string; expiresAt: number };

export class DurableGoogleAccessTokenProvider {
  private cached?: CachedToken;
  private inFlight?: Promise<string>;
  private readonly options: { repository: GoogleDriveOAuthRepository; keyring: GoogleOAuthKeyring;
    configuration: GoogleOAuthRuntimeConfiguration; client?: Pick<GoogleOAuthClient, "refresh">; clock?: () => Date;
    onReauthRequired?: (connection: GoogleDriveOAuthConnection) => Promise<void> | void };

  constructor(options: { repository: GoogleDriveOAuthRepository; keyring: GoogleOAuthKeyring;
    configuration: GoogleOAuthRuntimeConfiguration; client?: Pick<GoogleOAuthClient, "refresh">; clock?: () => Date;
    onReauthRequired?: (connection: GoogleDriveOAuthConnection) => Promise<void> | void }) { this.options = options; }

  clearMemoryCache() { this.cached = undefined; }
  private now() { return (this.options.clock?.() ?? new Date()).getTime(); }

  async accessToken() {
    if (this.cached && this.cached.expiresAt - 60_000 > this.now()) return this.cached.token;
    if (!this.inFlight) this.inFlight = this.refresh().finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }

  private async refresh() {
    const connection = await this.options.repository.getConnection();
    if (!connection || connection.state !== "CONNECTED" || !connection.refreshTokenEnvelope) throw new GoogleDriveOAuthError("GOOGLE_DRIVE_REAUTH_REQUIRED");
    const refreshToken = await decryptSecret(connection.refreshTokenEnvelope, connectionTokenAad({ id: connection.id, ownerSubject: connection.ownerSubject,
      scopes: connection.scopes, keyVersion: connection.refreshTokenEnvelope.keyVersion }), this.options.keyring);
    try {
      const result = await (this.options.client ?? new GoogleOAuthClient(this.options.configuration)).refresh(refreshToken);
      const now = new Date(this.now()).toISOString();
      const scopes = result.scopes.length ? result.scopes : connection.scopes;
      const rotatedEnvelope = result.refreshToken
        ? await encryptSecret(result.refreshToken, connectionTokenAad({ id: connection.id, ownerSubject: connection.ownerSubject, scopes, keyVersion: this.options.keyring.activeVersion }), this.options.keyring)
        : connection.refreshTokenEnvelope;
      try {
        await this.options.repository.updateConnection({ ...connection, scopes, refreshTokenEnvelope: rotatedEnvelope, lastRefreshAt: now, revision: connection.revision + 1 }, connection.revision);
      } catch (error) {
        if (!isConnectionConflict(error)) throw error;
        // Parallel document/media workers can refresh the same OAuth grant at
        // the same time.  The access token returned to this worker remains
        // valid; accept the winning durable update only if it still represents
        // the same connected Google account.
        const current = await this.options.repository.getConnection();
        if (!current || current.id !== connection.id || current.ownerSubject !== connection.ownerSubject || current.state !== "CONNECTED" || !current.refreshTokenEnvelope) throw error;
      }
      this.cached = { token: result.accessToken, expiresAt: this.now() + result.expiresIn * 1000 };
      return result.accessToken;
    } catch (error) {
      if (error instanceof GoogleDriveOAuthError && error.code === "GOOGLE_OAUTH_INVALID_GRANT") {
        const now = new Date(this.now()).toISOString();
        const next = { ...connection, state: "REAUTH_REQUIRED" as const, reauthRequiredAt: now, revision: connection.revision + 1 };
        await this.options.repository.updateConnection(next, connection.revision);
        await this.options.onReauthRequired?.(next);
        throw new GoogleDriveOAuthError("GOOGLE_DRIVE_REAUTH_REQUIRED");
      }
      throw error;
    }
  }
}

function isConnectionConflict(error: unknown) {
  return error instanceof Error && error.message === "GOOGLE_OAUTH_CONNECTION_CONFLICT";
}
