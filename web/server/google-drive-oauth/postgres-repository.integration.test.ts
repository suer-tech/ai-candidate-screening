import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { environmentProjection, loadRuntimeConfiguration } from "../configuration/runtime.ts";
import { migratePostgres } from "../storage/migrations.ts";
import { createPostgresClient } from "../storage/postgres.ts";
import { PostgresGoogleDriveOAuthRepository } from "./postgres-repository.ts";
import { GoogleDriveOAuthError, type GoogleDriveOAuthConnection, type SecretEnvelope } from "./types.ts";

const envelope: SecretEnvelope = { algorithm: "AES-256-GCM", keyVersion: "synthetic-v1", ciphertext: "ciphertext", nonce: "nonce", tag: "tag" };

test("PostgreSQL OAuth repository preserves PKCE, owner, optimistic refresh and descendant grants", async () => {
  const configuration = await loadRuntimeConfiguration(path.resolve(import.meta.dirname, "../.."));
  const baseUrl = environmentProjection(configuration).DATABASE_URL;
  const admin = createPostgresClient({ url: baseUrl, max: 1 });
  const databaseName = `oauth_integration_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const isolated = new URL(baseUrl); isolated.pathname = `/${databaseName}`;
  await admin.unsafe(`CREATE DATABASE ${databaseName}`);
  const database = createPostgresClient({ url: isolated.toString(), max: 2 });
  try {
    await migratePostgres(database, path.resolve(import.meta.dirname, "../../drizzle-postgres"));
    const repository = new PostgresGoogleDriveOAuthRepository(database);
    const now = new Date().toISOString();
    await repository.createOperation({ id: "operation-1", stateHash: "state-hash", principalId: "principal-1", redirectUri: "https://example.invalid/callback", returnPath: "/", verifierEnvelope: envelope, expiresAt: Date.now() + 60_000, createdAt: now });
    assert.equal((await repository.consumeOperation("state-hash", "principal-1", Date.now()))?.id, "operation-1");
    assert.equal(await repository.consumeOperation("state-hash", "principal-1", Date.now()), null);

    const connection: GoogleDriveOAuthConnection = { id: "connection-1", state: "CONNECTED", ownerSubject: "owner-1", ownerEmail: "person@example.invalid", scopes: ["drive"], rootFolderId: "root-1", rootFolderName: "Hiring", deploymentMode: "production-personal", refreshTokenEnvelope: envelope, connectedAt: now, revision: 1 };
    await repository.saveConnection(connection);
    assert.equal((await repository.getConnection())?.ownerSubject, "owner-1");
    await assert.rejects(repository.saveConnection({ ...connection, ownerSubject: "owner-2", revision: 2 }), (error) => error instanceof GoogleDriveOAuthError && error.code === "GOOGLE_OAUTH_ACCOUNT_MISMATCH");
    await repository.updateConnection({ ...connection, lastRefreshAt: now, revision: 2 }, 1);
    await assert.rejects(repository.updateConnection({ ...connection, revision: 3 }, 1), (error) => error instanceof GoogleDriveOAuthError && error.code === "GOOGLE_OAUTH_CONNECTION_CONFLICT");

    await repository.registerObject({ connectionId: connection.id, fileId: "root-1", kind: "root", name: "Hiring", discoveredAt: now });
    await repository.registerObject({ connectionId: connection.id, fileId: "candidate-1", parentId: "root-1", kind: "folder", name: "Candidate", operationIdentity: "candidate-folder:1", discoveredAt: now });
    await repository.registerObject({ connectionId: connection.id, fileId: "report-1", parentId: "candidate-1", kind: "derived", name: "Report", operationIdentity: "report:1", checksum: "sha256:synthetic", discoveredAt: now });
    assert.equal(await repository.isRegisteredDescendant(connection.id, "report-1", "root-1"), true);
    assert.equal((await repository.findByOperationIdentity(connection.id, "report:1"))?.fileId, "report-1");
    await assert.rejects(repository.removeRegisteredObject(connection.id, "report-1", "wrong"), /GOOGLE_DRIVE_REGISTERED_OBJECT_SCOPE_MISMATCH/);
    await repository.removeRegisteredObject(connection.id, "report-1", "report:1");
    await repository.disconnect(connection.id, 2, new Date().toISOString());
    const disconnected = await repository.getConnection();
    assert.equal(disconnected?.state, "DISCONNECTED");
    assert.equal(disconnected?.refreshTokenEnvelope, undefined);
  } finally {
    await database.end({ timeout: 5 });
    await admin.unsafe(`DROP DATABASE ${databaseName} WITH (FORCE)`);
    await admin.end({ timeout: 5 });
  }
});
