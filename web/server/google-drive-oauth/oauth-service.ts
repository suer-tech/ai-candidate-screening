import { connectionTokenAad, decryptSecret, encryptSecret, operationVerifierAad, randomBase64Url, sha256Base64Url, type GoogleOAuthKeyring } from "./crypto.ts";
import { GoogleOAuthClient } from "./oauth-client.ts";
import { GOOGLE_DRIVE_SCOPE, GoogleDriveOAuthError, type GoogleDriveOAuthConnection, type GoogleDriveOAuthRepository, type GoogleOAuthRuntimeConfiguration } from "./types.ts";

export type GoogleDriveRootBinder = (input: { accessToken: string; operationIdentity: string }) => Promise<{ id: string; name: string }>;

export class GoogleDriveOAuthService {
  private readonly options: {
    repository: GoogleDriveOAuthRepository;
    keyring: GoogleOAuthKeyring;
    configuration: GoogleOAuthRuntimeConfiguration;
    client?: Pick<GoogleOAuthClient, "authorizationUrl" | "exchangeCode" | "identity" | "revoke">;
    bindRoot: GoogleDriveRootBinder;
    clock?: () => Date;
    onReconnected?: (connection: GoogleDriveOAuthConnection) => Promise<void> | void;
  };

  constructor(options: GoogleDriveOAuthService["options"]) { this.options = options; }

  private clock() { return this.options.clock?.() ?? new Date(); }
  private client() { return this.options.client ?? new GoogleOAuthClient(this.options.configuration); }

  async start(principalId: string | null, returnPath = "/") {
    if (!principalId?.trim()) throw new GoogleDriveOAuthError("GOOGLE_OAUTH_AUTHENTICATION_REQUIRED");
    if (!returnPath.startsWith("/") || returnPath.startsWith("//") || returnPath.includes("\\")) throw new GoogleDriveOAuthError("GOOGLE_OAUTH_RETURN_PATH_INVALID");
    const id = crypto.randomUUID();
    const state = randomBase64Url(32);
    const verifier = randomBase64Url(64);
    const stateHash = await sha256Base64Url(state);
    const verifierEnvelope = await encryptSecret(verifier, operationVerifierAad({ id, principalId, redirectUri: this.options.configuration.redirectUri, keyVersion: this.options.keyring.activeVersion }), this.options.keyring);
    const now = this.clock();
    await this.options.repository.createOperation({ id, stateHash, principalId, redirectUri: this.options.configuration.redirectUri, returnPath,
      verifierEnvelope, expiresAt: now.getTime() + 10 * 60_000, createdAt: now.toISOString() });
    await this.options.repository.appendAudit({ principalId, eventType: "GOOGLE_DRIVE_OAUTH_CONNECT_STARTED", createdAt: now.toISOString() });
    return { authorizationUrl: this.client().authorizationUrl({ state, codeChallenge: await sha256Base64Url(verifier) }), expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString() };
  }

  async callback(input: { principalId: string | null; state: string; code: string }) {
    if (!input.principalId?.trim()) throw new GoogleDriveOAuthError("GOOGLE_OAUTH_AUTHENTICATION_REQUIRED");
    if (!input.state || !input.code) throw new GoogleDriveOAuthError("GOOGLE_OAUTH_CALLBACK_INVALID");
    const now = this.clock();
    const operation = await this.options.repository.consumeOperation(await sha256Base64Url(input.state), input.principalId, now.getTime());
    if (!operation) throw new GoogleDriveOAuthError("GOOGLE_OAUTH_STATE_INVALID");
    if (operation.redirectUri !== this.options.configuration.redirectUri) throw new GoogleDriveOAuthError("GOOGLE_OAUTH_REDIRECT_URI_MISMATCH");
    const verifier = await decryptSecret(operation.verifierEnvelope, operationVerifierAad({ id: operation.id, principalId: operation.principalId,
      redirectUri: operation.redirectUri, keyVersion: operation.verifierEnvelope.keyVersion }), this.options.keyring);
    const tokens = await this.client().exchangeCode(input.code, verifier);
    const identity = await this.client().identity(tokens.accessToken);
    const existing = await this.options.repository.getConnection();
    if (existing && existing.ownerSubject !== identity.subject) throw new GoogleDriveOAuthError("GOOGLE_OAUTH_ACCOUNT_MISMATCH");
    const connectionId = existing?.id ?? crypto.randomUUID();
    const root = await this.options.bindRoot({ accessToken: tokens.accessToken, operationIdentity: `google-drive-root:${connectionId}` });
    const scopes = [...new Set([...tokens.scopes, GOOGLE_DRIVE_SCOPE])];
    const envelope = await encryptSecret(tokens.refreshToken, connectionTokenAad({ id: connectionId, ownerSubject: identity.subject, scopes, keyVersion: this.options.keyring.activeVersion }), this.options.keyring);
    const connection: GoogleDriveOAuthConnection = { id: connectionId, state: "CONNECTED", ownerSubject: identity.subject, ownerEmail: identity.email,
      scopes, rootFolderId: root.id, rootFolderName: root.name, deploymentMode: this.options.configuration.deploymentMode, refreshTokenEnvelope: envelope,
      connectedAt: now.toISOString(), lastRefreshAt: now.toISOString(), revision: existing ? existing.revision + 1 : 1 };
    await this.options.repository.saveConnection(connection, existing?.ownerSubject);
    await this.options.repository.registerObject({ connectionId, fileId: root.id, kind: "root", name: root.name, operationIdentity: `google-drive-root:${connectionId}`, discoveredAt: now.toISOString() });
    await this.options.repository.appendAudit({ connectionId, principalId: input.principalId, eventType: existing ? "GOOGLE_DRIVE_OAUTH_RECONNECTED" : "GOOGLE_DRIVE_OAUTH_CONNECTED", createdAt: now.toISOString() });
    if (existing) await this.options.onReconnected?.(connection);
    return { returnPath: operation.returnPath, connection: projectGoogleDriveConnection(connection) };
  }

  async disconnect(principalId: string | null) {
    if (!principalId?.trim()) throw new GoogleDriveOAuthError("GOOGLE_OAUTH_AUTHENTICATION_REQUIRED");
    const current = await this.options.repository.getConnection();
    if (!current) return { state: "DISCONNECTED" as const };
    if (current.refreshTokenEnvelope) {
      try {
        const token = await decryptSecret(current.refreshTokenEnvelope, connectionTokenAad({ id: current.id, ownerSubject: current.ownerSubject,
          scopes: current.scopes, keyVersion: current.refreshTokenEnvelope.keyVersion }), this.options.keyring);
        await this.client().revoke(token);
      } catch { /* Local grant removal is authoritative even if Google revoke is unavailable. */ }
    }
    const timestamp = this.clock().toISOString();
    await this.options.repository.disconnect(current.id, current.revision, timestamp);
    await this.options.repository.appendAudit({ connectionId: current.id, principalId, eventType: "GOOGLE_DRIVE_OAUTH_DISCONNECTED", createdAt: timestamp });
    return { state: "DISCONNECTED" as const };
  }
}

export function projectGoogleDriveConnection(connection: GoogleDriveOAuthConnection | null) {
  if (!connection) return { state: "DISCONNECTED" as const, connected: false, nextAction: "Подключить Google Drive" };
  return { connected: connection.state === "CONNECTED", state: connection.state, ownerEmail: connection.ownerEmail, rootFolderId: connection.rootFolderId,
    rootFolderName: connection.rootFolderName, rootFolderUrl: `https://drive.google.com/drive/folders/${encodeURIComponent(connection.rootFolderId)}`,
    lastRefreshAt: connection.lastRefreshAt,
    nextAction: connection.state === "REAUTH_REQUIRED" ? "Переподключить Google Drive" : connection.state === "DISCONNECTED" ? "Подключить Google Drive" : undefined };
}
