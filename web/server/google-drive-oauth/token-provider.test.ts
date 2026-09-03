import assert from "node:assert/strict";
import test from "node:test";
import { connectionTokenAad, encryptSecret, type GoogleOAuthKeyring } from "./crypto.ts";
import { MemoryGoogleDriveOAuthRepository } from "./memory-repository.ts";
import { DurableGoogleAccessTokenProvider } from "./token-provider.ts";
import { GOOGLE_DRIVE_SCOPE, GoogleDriveOAuthError, type GoogleDriveOAuthConnection } from "./types.ts";

const keyring: GoogleOAuthKeyring = { activeVersion: "test-v1", keys: { "test-v1": new Uint8Array(32).fill(17) } };

async function connection(): Promise<GoogleDriveOAuthConnection> {
  const scopes = [GOOGLE_DRIVE_SCOPE];
  const refreshTokenEnvelope = await encryptSecret("synthetic-refresh-token", connectionTokenAad({ id: "connection-1", ownerSubject: "subject-1", scopes, keyVersion: keyring.activeVersion }), keyring);
  return { id: "connection-1", state: "CONNECTED", ownerSubject: "subject-1", ownerEmail: "owner@example.invalid", scopes,
    rootFolderId: "root-1", rootFolderName: "Найм", deploymentMode: "testing", refreshTokenEnvelope, connectedAt: "2026-09-03T00:00:00.000Z", revision: 1 };
}

test("parallel OAuth refresh accepts a concurrent durable winner for the same connected account", async () => {
  const repository = new MemoryGoogleDriveOAuthRepository();
  const seeded = await connection();
  await repository.saveConnection(seeded);
  let first = true;
  const racingRepository = {
    ...repository,
    getConnection: repository.getConnection.bind(repository),
    updateConnection: async (value: GoogleDriveOAuthConnection, expectedRevision: number) => {
      if (first) {
        first = false;
        await repository.updateConnection({ ...value, revision: expectedRevision + 1 }, expectedRevision);
        throw new GoogleDriveOAuthError("GOOGLE_OAUTH_CONNECTION_CONFLICT", true);
      }
      return repository.updateConnection(value, expectedRevision);
    },
  };
  const provider = new DurableGoogleAccessTokenProvider({ repository: racingRepository, keyring,
    configuration: {} as never, client: { async refresh() { return { accessToken: "synthetic-access-token", expiresIn: 3600, scopes: [GOOGLE_DRIVE_SCOPE] }; } } });
  assert.equal(await provider.accessToken(), "synthetic-access-token");
});

test("parallel OAuth refresh does not hide a concurrent disconnect", async () => {
  const repository = new MemoryGoogleDriveOAuthRepository();
  const seeded = await connection();
  await repository.saveConnection(seeded);
  const racingRepository = {
    ...repository,
    getConnection: repository.getConnection.bind(repository),
    updateConnection: async (_value: GoogleDriveOAuthConnection, expectedRevision: number) => {
      await repository.disconnect(seeded.id, expectedRevision, "2026-09-03T00:01:00.000Z");
      throw new GoogleDriveOAuthError("GOOGLE_OAUTH_CONNECTION_CONFLICT", true);
    },
  };
  const provider = new DurableGoogleAccessTokenProvider({ repository: racingRepository, keyring,
    configuration: {} as never, client: { async refresh() { return { accessToken: "synthetic-access-token", expiresIn: 3600, scopes: [GOOGLE_DRIVE_SCOPE] }; } } });
  await assert.rejects(() => provider.accessToken(), /GOOGLE_OAUTH_CONNECTION_CONFLICT/);
});
