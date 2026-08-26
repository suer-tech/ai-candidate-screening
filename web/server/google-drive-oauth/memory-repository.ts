import type { GoogleDriveOAuthAuditEvent, GoogleDriveOAuthConnection, GoogleDriveOAuthOperation, GoogleDriveOAuthRepository, RegisteredDriveObject } from "./types.ts";

export class MemoryGoogleDriveOAuthRepository implements GoogleDriveOAuthRepository {
  private connection: GoogleDriveOAuthConnection | null = null;
  private readonly operations = new Map<string, GoogleDriveOAuthOperation>();
  private readonly objects = new Map<string, RegisteredDriveObject>();
  readonly audit: GoogleDriveOAuthAuditEvent[] = [];

  tamperOperationVerifier(stateHash: string) {
    const operation = this.operations.get(stateHash);
    if (operation) operation.verifierEnvelope = { ...operation.verifierEnvelope, tag: `${operation.verifierEnvelope.tag[0] === "A" ? "B" : "A"}${operation.verifierEnvelope.tag.slice(1)}` };
  }

  registeredObjects() { return [...this.objects.values()].map((value) => structuredClone(value)); }

  removeDerivedObjects() {
    for (const [key, value] of this.objects) if (value.kind === "derived") this.objects.delete(key);
  }

  async createOperation(operation: GoogleDriveOAuthOperation) {
    if (this.operations.has(operation.stateHash)) throw new Error("GOOGLE_OAUTH_STATE_CONFLICT");
    this.operations.set(operation.stateHash, structuredClone(operation));
  }

  async consumeOperation(stateHash: string, principalId: string, now: number) {
    const operation = this.operations.get(stateHash);
    if (!operation || operation.principalId !== principalId || operation.consumedAt !== undefined || operation.expiresAt < now) return null;
    operation.consumedAt = now;
    return structuredClone(operation);
  }

  async countOperationsForPrincipal(principalId: string) {
    return [...this.operations.values()].filter((operation) => operation.principalId === principalId).length;
  }

  async getConnection() { return this.connection ? structuredClone(this.connection) : null; }

  async saveConnection(connection: GoogleDriveOAuthConnection, expectedOwnerSubject?: string) {
    if (expectedOwnerSubject && this.connection && this.connection.ownerSubject !== expectedOwnerSubject) throw new Error("GOOGLE_OAUTH_ACCOUNT_MISMATCH");
    if (this.connection && this.connection.ownerSubject !== connection.ownerSubject) throw new Error("GOOGLE_OAUTH_ACCOUNT_MISMATCH");
    this.connection = structuredClone(connection);
  }

  async updateConnection(connection: GoogleDriveOAuthConnection, expectedRevision: number) {
    if (!this.connection || this.connection.id !== connection.id || this.connection.revision !== expectedRevision) throw new Error("GOOGLE_OAUTH_CONNECTION_CONFLICT");
    this.connection = structuredClone(connection);
  }

  async disconnect(connectionId: string, expectedRevision: number, disconnectedAt: string) {
    if (!this.connection || this.connection.id !== connectionId || this.connection.revision !== expectedRevision) throw new Error("GOOGLE_OAUTH_CONNECTION_CONFLICT");
    this.connection = { ...this.connection, state: "DISCONNECTED", refreshTokenEnvelope: undefined, disconnectedAt, revision: expectedRevision + 1 };
  }

  async registerObject(object: RegisteredDriveObject) { this.objects.set(`${object.connectionId}:${object.fileId}`, structuredClone(object)); }

  async removeRegisteredObject(connectionId: string, fileId: string, operationIdentity: string) {
    const key = `${connectionId}:${fileId}`;
    const current = this.objects.get(key);
    if (!current || current.operationIdentity !== operationIdentity) throw new Error("GOOGLE_DRIVE_REGISTERED_OBJECT_SCOPE_MISMATCH");
    this.objects.delete(key);
  }

  async isRegisteredDescendant(connectionId: string, fileId: string, rootFolderId: string) {
    let current = this.objects.get(`${connectionId}:${fileId}`);
    const visited = new Set<string>();
    while (current && !visited.has(current.fileId)) {
      if (current.fileId === rootFolderId) return true;
      visited.add(current.fileId);
      current = current.parentId ? this.objects.get(`${connectionId}:${current.parentId}`) : undefined;
    }
    return false;
  }

  async findByOperationIdentity(connectionId: string, operationIdentity: string) {
    const value = [...this.objects.values()].find((object) => object.connectionId === connectionId && object.operationIdentity === operationIdentity);
    return value ? structuredClone(value) : null;
  }

  async appendAudit(event: GoogleDriveOAuthAuditEvent) { this.audit.push(structuredClone(event)); }
}
