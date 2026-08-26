import { parseGoogleOAuthKeyring } from "./crypto.ts";
import { loadGoogleOAuthConfiguration } from "./configuration.ts";
import { PostgresGoogleDriveOAuthRepository } from "./postgres-repository.ts";
import { ensurePersonalDriveRoot, GoogleMyDriveAdapter } from "./my-drive-adapter.ts";
import { GoogleDriveOAuthService, projectGoogleDriveConnection } from "./oauth-service.ts";
import { probeGoogleDriveOperationalReadiness } from "./readiness.ts";
import { DurableGoogleAccessTokenProvider } from "./token-provider.ts";
import type { GoogleDriveOAuthEnvironment } from "./types.ts";
import type { PostgresClient } from "../storage/postgres.ts";

export function createGoogleDriveOAuthRuntime(input: { database: PostgresClient; environment: GoogleDriveOAuthEnvironment; fetcher?: typeof fetch; resumeRuns?: (connectionId: string, ownerSubject: string) => Promise<void> }) {
  const configuration = loadGoogleOAuthConfiguration(input.environment);
  const keyring = parseGoogleOAuthKeyring(input.environment.GOOGLE_OAUTH_TOKEN_KEYRING_JSON);
  const repository = new PostgresGoogleDriveOAuthRepository(input.database);
  const service = new GoogleDriveOAuthService({ repository, keyring, configuration,
    bindRoot: ({ accessToken, operationIdentity }) => ensurePersonalDriveRoot({ accessToken, operationIdentity, fetch: input.fetcher }),
    onReconnected: async (connection) => { await input.resumeRuns?.(connection.id, connection.ownerSubject); } });
  const tokenProvider = new DurableGoogleAccessTokenProvider({ repository, keyring, configuration });
  return {
    configuration,
    repository,
    service,
    tokenProvider,
    async status() { return projectGoogleDriveConnection(await repository.getConnection()); },
    async drive() {
      const connection = await repository.getConnection();
      if (!connection || connection.state !== "CONNECTED") throw new Error("GOOGLE_DRIVE_REAUTH_REQUIRED");
      return new GoogleMyDriveAdapter({ connectionId: connection.id, rootFolderId: connection.rootFolderId, repository,
        accessToken: () => tokenProvider.accessToken(), fetch: input.fetcher });
    },
    async readiness() {
      return probeGoogleDriveOperationalReadiness({
        environment: input.environment,
        repository,
        keyring,
        tokenProvider,
        drive: async () => {
          const connection = await repository.getConnection();
          if (!connection || connection.state !== "CONNECTED") throw new Error("GOOGLE_DRIVE_REAUTH_REQUIRED");
          return new GoogleMyDriveAdapter({ connectionId: connection.id, rootFolderId: connection.rootFolderId, repository,
            accessToken: () => tokenProvider.accessToken(), fetch: input.fetcher });
        },
      });
    },
  };
}
