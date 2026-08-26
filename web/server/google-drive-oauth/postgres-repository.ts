import { randomUUID } from "node:crypto";
import type { PostgresClient } from "../storage/postgres.ts";
import { withTransaction } from "../storage/postgres.ts";
import { GoogleDriveOAuthError, type GoogleDriveOAuthAuditEvent, type GoogleDriveOAuthConnection, type GoogleDriveOAuthOperation, type GoogleDriveOAuthRepository, type RegisteredDriveObject, type SecretEnvelope } from "./types.ts";

type Row = Record<string, unknown>;
function envelope(row: Row, prefix: "token" | "verifier"): SecretEnvelope | undefined {
  const values = [row[`${prefix}_ciphertext`], row[`${prefix}_nonce`], row[`${prefix}_tag`], row[`${prefix}_key_version`]];
  return values.every((value) => typeof value === "string") ? { algorithm: "AES-256-GCM", ciphertext: String(values[0]), nonce: String(values[1]), tag: String(values[2]), keyVersion: String(values[3]) } : undefined;
}
function connection(row: Row): GoogleDriveOAuthConnection {
  return { id: String(row.id), state: String(row.state) as GoogleDriveOAuthConnection["state"], ownerSubject: String(row.owner_subject), ownerEmail: String(row.owner_email),
    scopes: JSON.parse(String(row.scopes_json)) as string[], rootFolderId: String(row.root_folder_id), rootFolderName: String(row.root_folder_name), deploymentMode: String(row.deployment_mode) as GoogleDriveOAuthConnection["deploymentMode"],
    refreshTokenEnvelope: envelope(row, "token"), connectedAt: String(row.connected_at), lastRefreshAt: row.last_refresh_at ? String(row.last_refresh_at) : undefined,
    reauthRequiredAt: row.reauth_required_at ? String(row.reauth_required_at) : undefined, disconnectedAt: row.disconnected_at ? String(row.disconnected_at) : undefined, revision: Number(row.revision) };
}
function operation(row: Row): GoogleDriveOAuthOperation {
  const verifierEnvelope = envelope(row, "verifier"); if (!verifierEnvelope) throw new GoogleDriveOAuthError("GOOGLE_OAUTH_OPERATION_ENVELOPE_MISSING");
  return { id: String(row.id), stateHash: String(row.state_hash), principalId: String(row.principal_id), redirectUri: String(row.redirect_uri), returnPath: String(row.return_path), verifierEnvelope,
    expiresAt: Number(row.expires_at), consumedAt: row.consumed_at == null ? undefined : Number(row.consumed_at), createdAt: String(row.created_at) };
}
function registered(row: Row): RegisteredDriveObject {
  return { connectionId: String(row.connection_id), fileId: String(row.file_id), parentId: row.parent_id ? String(row.parent_id) : undefined,
    kind: String(row.kind) as RegisteredDriveObject["kind"], name: String(row.name), operationIdentity: row.operation_identity ? String(row.operation_identity) : undefined,
    checksum: row.checksum ? String(row.checksum) : undefined, discoveredAt: String(row.discovered_at) };
}

export class PostgresGoogleDriveOAuthRepository implements GoogleDriveOAuthRepository {
  private readonly sql: PostgresClient;
  constructor(sql: PostgresClient) { this.sql = sql; }
  async createOperation(value: GoogleDriveOAuthOperation) {
    await this.sql`INSERT INTO google_drive_oauth_operations
      (id,state_hash,principal_id,redirect_uri,return_path,verifier_ciphertext,verifier_nonce,verifier_tag,verifier_key_version,expires_at,consumed_at,created_at)
      VALUES (${value.id},${value.stateHash},${value.principalId},${value.redirectUri},${value.returnPath},${value.verifierEnvelope.ciphertext},${value.verifierEnvelope.nonce},${value.verifierEnvelope.tag},${value.verifierEnvelope.keyVersion},${value.expiresAt},NULL,${value.createdAt})`;
  }
  async consumeOperation(stateHash: string, principalId: string, now: number) {
    const rows = await this.sql<Row[]>`UPDATE google_drive_oauth_operations SET consumed_at=${now} WHERE state_hash=${stateHash} AND principal_id=${principalId} AND consumed_at IS NULL AND expires_at>=${now} RETURNING *`;
    return rows[0] ? operation(rows[0]) : null;
  }
  async countOperationsForPrincipal(principalId: string) { const [row] = await this.sql<{ count: number }[]>`SELECT count(*)::integer AS count FROM google_drive_oauth_operations WHERE principal_id=${principalId}`; return row.count; }
  async getConnection() { const rows = await this.sql<Row[]>`SELECT * FROM google_drive_oauth_connections WHERE singleton_key='primary'`; return rows[0] ? connection(rows[0]) : null; }
  async saveConnection(value: GoogleDriveOAuthConnection, expectedOwnerSubject?: string) {
    const token = value.refreshTokenEnvelope; if (!token) throw new GoogleDriveOAuthError("GOOGLE_OAUTH_REFRESH_TOKEN_MISSING");
    await withTransaction(this.sql, async (transaction) => {
      const rows = await transaction<Row[]>`SELECT * FROM google_drive_oauth_connections WHERE singleton_key='primary' FOR UPDATE`;
      const current = rows[0] ? connection(rows[0]) : null;
      if (current && (current.ownerSubject !== value.ownerSubject || (expectedOwnerSubject && current.ownerSubject !== expectedOwnerSubject))) throw new GoogleDriveOAuthError("GOOGLE_OAUTH_ACCOUNT_MISMATCH");
      if (!current) {
        await transaction`INSERT INTO google_drive_oauth_connections
          (id,singleton_key,state,owner_subject,owner_email,scopes_json,root_folder_id,root_folder_name,deployment_mode,token_ciphertext,token_nonce,token_tag,token_key_version,connected_at,last_refresh_at,revision)
          VALUES (${value.id},'primary',${value.state},${value.ownerSubject},${value.ownerEmail},${JSON.stringify(value.scopes)},${value.rootFolderId},${value.rootFolderName},${value.deploymentMode},${token.ciphertext},${token.nonce},${token.tag},${token.keyVersion},${value.connectedAt},${value.lastRefreshAt ?? null},${value.revision})`;
      } else {
        const updated = await transaction`UPDATE google_drive_oauth_connections SET state=${value.state},owner_email=${value.ownerEmail},scopes_json=${JSON.stringify(value.scopes)},root_folder_id=${value.rootFolderId},root_folder_name=${value.rootFolderName},deployment_mode=${value.deploymentMode},
          token_ciphertext=${token.ciphertext},token_nonce=${token.nonce},token_tag=${token.tag},token_key_version=${token.keyVersion},connected_at=${value.connectedAt},last_refresh_at=${value.lastRefreshAt ?? null},reauth_required_at=NULL,disconnected_at=NULL,revision=revision+1
          WHERE singleton_key='primary' AND owner_subject=${value.ownerSubject} AND revision=${current.revision} RETURNING id`;
        if (updated.length !== 1) throw new GoogleDriveOAuthError("GOOGLE_OAUTH_CONNECTION_CONFLICT", true);
      }
    });
  }
  async updateConnection(value: GoogleDriveOAuthConnection, expectedRevision: number) {
    const token = value.refreshTokenEnvelope;
    const rows = await this.sql`UPDATE google_drive_oauth_connections SET state=${value.state},owner_email=${value.ownerEmail},scopes_json=${JSON.stringify(value.scopes)},root_folder_id=${value.rootFolderId},root_folder_name=${value.rootFolderName},deployment_mode=${value.deploymentMode},
      token_ciphertext=${token?.ciphertext ?? null},token_nonce=${token?.nonce ?? null},token_tag=${token?.tag ?? null},token_key_version=${token?.keyVersion ?? null},last_refresh_at=${value.lastRefreshAt ?? null},reauth_required_at=${value.reauthRequiredAt ?? null},disconnected_at=${value.disconnectedAt ?? null},revision=${value.revision}
      WHERE id=${value.id} AND revision=${expectedRevision} RETURNING id`;
    if (rows.length !== 1) throw new GoogleDriveOAuthError("GOOGLE_OAUTH_CONNECTION_CONFLICT", true);
  }
  async disconnect(connectionId: string, expectedRevision: number, disconnectedAt: string) {
    const rows = await this.sql`UPDATE google_drive_oauth_connections SET state='DISCONNECTED',token_ciphertext=NULL,token_nonce=NULL,token_tag=NULL,token_key_version=NULL,disconnected_at=${disconnectedAt},revision=revision+1 WHERE id=${connectionId} AND revision=${expectedRevision} RETURNING id`;
    if (rows.length !== 1) throw new GoogleDriveOAuthError("GOOGLE_OAUTH_CONNECTION_CONFLICT", true);
  }
  async registerObject(value: RegisteredDriveObject) {
    await this.sql`INSERT INTO google_drive_registered_objects (connection_id,file_id,parent_id,kind,name,operation_identity,checksum,discovered_at)
      VALUES (${value.connectionId},${value.fileId},${value.parentId ?? null},${value.kind},${value.name},${value.operationIdentity ?? null},${value.checksum ?? null},${value.discoveredAt})
      ON CONFLICT (connection_id,file_id) DO UPDATE SET parent_id=excluded.parent_id,kind=excluded.kind,name=excluded.name,operation_identity=COALESCE(excluded.operation_identity,google_drive_registered_objects.operation_identity),checksum=COALESCE(excluded.checksum,google_drive_registered_objects.checksum),discovered_at=excluded.discovered_at`;
  }
  async removeRegisteredObject(connectionId: string, fileId: string, operationIdentity: string) {
    const rows = await this.sql`DELETE FROM google_drive_registered_objects WHERE connection_id=${connectionId} AND file_id=${fileId} AND operation_identity=${operationIdentity} AND kind IN ('folder','derived') RETURNING file_id`;
    if (rows.length !== 1) throw new GoogleDriveOAuthError("GOOGLE_DRIVE_REGISTERED_OBJECT_SCOPE_MISMATCH");
  }
  async isRegisteredDescendant(connectionId: string, fileId: string, rootFolderId: string) {
    const rows = await this.sql`WITH RECURSIVE ancestry(file_id,parent_id,depth) AS (
      SELECT file_id,parent_id,0 FROM google_drive_registered_objects WHERE connection_id=${connectionId} AND file_id=${fileId}
      UNION ALL SELECT parent.file_id,parent.parent_id,ancestry.depth+1 FROM google_drive_registered_objects parent JOIN ancestry ON parent.file_id=ancestry.parent_id WHERE parent.connection_id=${connectionId} AND ancestry.depth<64
    ) SELECT 1 FROM ancestry WHERE file_id=${rootFolderId} LIMIT 1`;
    return rows.length === 1;
  }
  async findByOperationIdentity(connectionId: string, operationIdentity: string) { const rows = await this.sql<Row[]>`SELECT * FROM google_drive_registered_objects WHERE connection_id=${connectionId} AND operation_identity=${operationIdentity}`; return rows[0] ? registered(rows[0]) : null; }
  async appendAudit(value: GoogleDriveOAuthAuditEvent) { await this.sql`INSERT INTO google_drive_oauth_audit_events (id,connection_id,principal_id,event_type,safe_code,created_at) VALUES (${randomUUID()},${value.connectionId ?? null},${value.principalId},${value.eventType},${value.safeCode ?? null},${value.createdAt})`; }
}
