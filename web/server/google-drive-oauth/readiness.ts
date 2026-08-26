import { connectionTokenAad, decryptSecret, type GoogleOAuthKeyring } from "./crypto.ts";
import { loadGoogleOAuthConfiguration } from "./configuration.ts";
import type { GoogleDrivePort } from "./my-drive-adapter.ts";
import type { DurableGoogleAccessTokenProvider } from "./token-provider.ts";
import { GoogleDriveOAuthError, type GoogleDriveOAuthEnvironment, type GoogleDriveOAuthRepository } from "./types.ts";

export type GoogleDriveReadinessCheck = {
  name: "configuration" | "token-envelope" | "active-owner" | "root-read" | "root-write";
  ready: boolean;
  code: string;
};

export type GoogleDriveOperationalReadiness = {
  ready: boolean;
  providerMode: "real";
  deploymentMode?: "testing" | "production-personal";
  checks: GoogleDriveReadinessCheck[];
  permissions: { readInputs: boolean; createOutputs: boolean; manageMembers: false };
};

const safeCode = (error: unknown, fallback: string) => error instanceof GoogleDriveOAuthError ? error.code : fallback;

export async function probeGoogleDriveOperationalReadiness(input: {
  environment: GoogleDriveOAuthEnvironment;
  repository: GoogleDriveOAuthRepository;
  keyring: GoogleOAuthKeyring;
  tokenProvider: DurableGoogleAccessTokenProvider;
  drive: () => Promise<GoogleDrivePort>;
  probeIdentity?: string;
}) {
  const checks: GoogleDriveReadinessCheck[] = [];
  let deploymentMode: GoogleDriveOperationalReadiness["deploymentMode"];
  try {
    deploymentMode = loadGoogleOAuthConfiguration(input.environment).deploymentMode;
    checks.push({ name: "configuration", ready: true, code: "READY" });
  } catch (error) {
    checks.push({ name: "configuration", ready: false, code: safeCode(error, "GOOGLE_OAUTH_CONFIGURATION_INVALID") });
    return result(checks, deploymentMode);
  }

  const connection = await input.repository.getConnection();
  if (!connection || connection.state !== "CONNECTED" || !connection.ownerSubject || !connection.ownerEmail) {
    checks.push({ name: "active-owner", ready: false, code: "GOOGLE_DRIVE_ACTIVE_OWNER_MISSING" });
    return result(checks, deploymentMode);
  }
  checks.push({ name: "active-owner", ready: true, code: "READY" });

  if (!connection.refreshTokenEnvelope) {
    checks.push({ name: "token-envelope", ready: false, code: "GOOGLE_OAUTH_REFRESH_TOKEN_MISSING" });
    return result(checks, deploymentMode);
  }
  try {
    await decryptSecret(connection.refreshTokenEnvelope, connectionTokenAad({
      id: connection.id,
      ownerSubject: connection.ownerSubject,
      scopes: connection.scopes,
      keyVersion: connection.refreshTokenEnvelope.keyVersion,
    }), input.keyring);
    await input.tokenProvider.accessToken();
    checks.push({ name: "token-envelope", ready: true, code: "READY" });
  } catch (error) {
    checks.push({ name: "token-envelope", ready: false, code: safeCode(error, "GOOGLE_OAUTH_TOKEN_DECRYPT_OR_REFRESH_FAILED") });
    return result(checks, deploymentMode);
  }

  let drive: GoogleDrivePort;
  try {
    drive = await input.drive();
    await drive.listChildren(connection.rootFolderId);
    checks.push({ name: "root-read", ready: true, code: "READY" });
  } catch (error) {
    checks.push({ name: "root-read", ready: false, code: safeCode(error, "GOOGLE_DRIVE_ROOT_READ_FAILED") });
    return result(checks, deploymentMode);
  }

  const probeIdentity = input.probeIdentity ?? `google-drive-readiness:${connection.id}`;
  try {
    const folder = await drive.ensureFolder({ name: ".hh-readiness-probe", parentFolderId: connection.rootFolderId, operationIdentity: probeIdentity });
    await drive.removeCreatedObject({ fileId: folder.id, operationIdentity: probeIdentity });
    checks.push({ name: "root-write", ready: true, code: "READY" });
  } catch (error) {
    checks.push({ name: "root-write", ready: false, code: safeCode(error, "GOOGLE_DRIVE_ROOT_WRITE_FAILED") });
  }
  return result(checks, deploymentMode);
}

function result(checks: GoogleDriveReadinessCheck[], deploymentMode: GoogleDriveOperationalReadiness["deploymentMode"]): GoogleDriveOperationalReadiness {
  const read = checks.find((check) => check.name === "root-read")?.ready === true;
  const write = checks.find((check) => check.name === "root-write")?.ready === true;
  return {
    ready: checks.length === 5 && checks.every((check) => check.ready),
    providerMode: "real",
    deploymentMode,
    checks,
    permissions: { readInputs: read, createOutputs: write, manageMembers: false },
  };
}
