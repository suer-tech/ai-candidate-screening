import { GoogleDriveOAuthError, type GoogleDriveOAuthEnvironment, type GoogleOAuthDeploymentMode, type GoogleOAuthRuntimeConfiguration } from "./types.ts";

const CALLBACK_PATH = "/api/integrations/google-drive/oauth/callback";

function required(environment: GoogleDriveOAuthEnvironment, name: keyof GoogleDriveOAuthEnvironment) {
  const value = environment[name];
  if (typeof value !== "string" || !value.trim()) throw new GoogleDriveOAuthError(`${String(name)}_MISSING`);
  if (/^(?:replace|paste)(?:[-_ ]|$)|REPLACE_WITH|PASTE_/i.test(value)) throw new GoogleDriveOAuthError(`${String(name)}_PLACEHOLDER`);
  return value.trim();
}

export function rejectUnsupportedDriveBackend(environment: GoogleDriveOAuthEnvironment) {
  const supplied = environment as unknown as Record<string, unknown>;
  if ([supplied.GOOGLE_SHARED_DRIVE_ID, supplied.GOOGLE_SHARED_DRIVE_ROOT_FOLDER_ID, supplied.GOOGLE_SERVICE_ACCOUNT_JSON]
    .some((value) => typeof value === "string" && value.trim())) {
    throw new GoogleDriveOAuthError("GOOGLE_DRIVE_BACKEND_UNSUPPORTED");
  }
}

export function loadGoogleOAuthConfiguration(environment: GoogleDriveOAuthEnvironment): GoogleOAuthRuntimeConfiguration {
  rejectUnsupportedDriveBackend(environment);
  const runtimeEnvironment = environment.E2E_ENVIRONMENT === "local" ? "local"
    : environment.E2E_ENVIRONMENT === "staging" ? "staging"
      : environment.E2E_ENVIRONMENT === "preproduction" ? "preproduction" : "production";
  const deploymentMode = required(environment, "GOOGLE_OAUTH_DEPLOYMENT_MODE") as GoogleOAuthDeploymentMode;
  if (deploymentMode !== "testing" && deploymentMode !== "production-personal") throw new GoogleDriveOAuthError("GOOGLE_OAUTH_DEPLOYMENT_MODE_INVALID");
  if (runtimeEnvironment === "production" && deploymentMode === "testing") throw new GoogleDriveOAuthError("GOOGLE_OAUTH_TESTING_GRANT_NOT_DURABLE");

  const redirectUri = required(environment, "GOOGLE_OAUTH_REDIRECT_URI");
  let redirect: URL;
  try { redirect = new URL(redirectUri); } catch { throw new GoogleDriveOAuthError("GOOGLE_OAUTH_REDIRECT_URI_INVALID"); }
  if (redirect.pathname !== CALLBACK_PATH || redirect.search || redirect.hash) throw new GoogleDriveOAuthError("GOOGLE_OAUTH_REDIRECT_URI_INVALID");
  if (runtimeEnvironment === "local") {
    if (redirect.origin !== "http://localhost:3000") throw new GoogleDriveOAuthError("GOOGLE_OAUTH_LOCAL_REDIRECT_URI_INVALID");
  } else if (redirect.protocol !== "https:") throw new GoogleDriveOAuthError("GOOGLE_OAUTH_HTTPS_REDIRECT_REQUIRED");

  return {
    clientId: required(environment, "GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: required(environment, "GOOGLE_OAUTH_CLIENT_SECRET"),
    redirectUri,
    deploymentMode,
    environment: runtimeEnvironment,
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    userInfoEndpoint: "https://openidconnect.googleapis.com/v1/userinfo",
    revokeEndpoint: "https://oauth2.googleapis.com/revoke",
  };
}

export function googleOAuthReadiness(environment: GoogleDriveOAuthEnvironment) {
  try {
    const configuration = loadGoogleOAuthConfiguration(environment);
    return { ready: true as const, code: "READY", configuration };
  } catch (error) {
    const code = error instanceof GoogleDriveOAuthError ? error.code : "GOOGLE_OAUTH_CONFIGURATION_INVALID";
    return { ready: false as const, code };
  }
}
