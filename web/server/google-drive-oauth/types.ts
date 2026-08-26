export const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
export const GOOGLE_IDENTITY_SCOPES = ["openid", "email"] as const;

export type GoogleOAuthDeploymentMode = "testing" | "production-personal";
export type GoogleDriveConnectionState = "CONNECTED" | "REAUTH_REQUIRED" | "DISCONNECTED" | "MISCONFIGURED";

export type SecretEnvelope = {
  algorithm: "AES-256-GCM";
  keyVersion: string;
  ciphertext: string;
  nonce: string;
  tag: string;
};

export type GoogleDriveOAuthConnection = {
  id: string;
  state: GoogleDriveConnectionState;
  ownerSubject: string;
  ownerEmail: string;
  scopes: string[];
  rootFolderId: string;
  rootFolderName: string;
  deploymentMode: GoogleOAuthDeploymentMode;
  refreshTokenEnvelope?: SecretEnvelope;
  connectedAt: string;
  lastRefreshAt?: string;
  reauthRequiredAt?: string;
  disconnectedAt?: string;
  revision: number;
};

export type GoogleDriveOAuthOperation = {
  id: string;
  stateHash: string;
  principalId: string;
  redirectUri: string;
  returnPath: string;
  verifierEnvelope: SecretEnvelope;
  expiresAt: number;
  consumedAt?: number;
  createdAt: string;
};

export type RegisteredDriveObject = {
  connectionId: string;
  fileId: string;
  parentId?: string;
  kind: "root" | "folder" | "file" | "derived";
  name: string;
  operationIdentity?: string;
  checksum?: string;
  discoveredAt: string;
};

export type GoogleDriveOAuthAuditEvent = {
  connectionId?: string;
  principalId: string;
  eventType: string;
  safeCode?: string;
  createdAt: string;
};

export interface GoogleDriveOAuthRepository {
  createOperation(operation: GoogleDriveOAuthOperation): Promise<void>;
  consumeOperation(stateHash: string, principalId: string, now: number): Promise<GoogleDriveOAuthOperation | null>;
  countOperationsForPrincipal(principalId: string): Promise<number>;
  getConnection(): Promise<GoogleDriveOAuthConnection | null>;
  saveConnection(connection: GoogleDriveOAuthConnection, expectedOwnerSubject?: string): Promise<void>;
  updateConnection(connection: GoogleDriveOAuthConnection, expectedRevision: number): Promise<void>;
  disconnect(connectionId: string, expectedRevision: number, disconnectedAt: string): Promise<void>;
  registerObject(object: RegisteredDriveObject): Promise<void>;
  removeRegisteredObject(connectionId: string, fileId: string, operationIdentity: string): Promise<void>;
  isRegisteredDescendant(connectionId: string, fileId: string, rootFolderId: string): Promise<boolean>;
  findByOperationIdentity(connectionId: string, operationIdentity: string): Promise<RegisteredDriveObject | null>;
  appendAudit(event: GoogleDriveOAuthAuditEvent): Promise<void>;
}

export type GoogleDriveOAuthEnvironment = {
  E2E_ENVIRONMENT?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_OAUTH_REDIRECT_URI?: string;
  GOOGLE_OAUTH_DEPLOYMENT_MODE?: string;
  GOOGLE_OAUTH_TOKEN_KEYRING_JSON?: string;
};

export type GoogleOAuthRuntimeConfiguration = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  deploymentMode: GoogleOAuthDeploymentMode;
  environment: "local" | "staging" | "preproduction" | "production";
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userInfoEndpoint: string;
  revokeEndpoint: string;
};

export class GoogleDriveOAuthError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, retryable = false) {
    super(code);
    this.code = code;
    this.retryable = retryable;
    this.name = "GoogleDriveOAuthError";
  }
}
