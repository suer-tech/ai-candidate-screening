import path from "node:path";
import { loadRuntimeConfiguration, environmentProjection } from "../server/configuration/runtime.ts";
import { parseGoogleOAuthKeyring } from "../server/google-drive-oauth/crypto.ts";
import { loadGoogleOAuthConfiguration } from "../server/google-drive-oauth/configuration.ts";

async function main() {
  const webRoot = path.resolve(import.meta.dirname, "..");
  const runtime = await loadRuntimeConfiguration(webRoot);
  const environment = environmentProjection(runtime);
  loadGoogleOAuthConfiguration(environment);
  parseGoogleOAuthKeyring(environment.GOOGLE_OAUTH_TOKEN_KEYRING_JSON);

  let connection = "приложение ещё не запущено";
  try {
    const response = await fetch("http://localhost:3000/api/integrations/google-drive/oauth/status", { signal: AbortSignal.timeout(3_000) });
    const projection = await response.json() as { state?: string; ownerEmail?: string; rootFolderName?: string };
    connection = projection.state === "CONNECTED"
      ? `подключено (${projection.ownerEmail ?? "owner"}, ${projection.rootFolderName ?? "Найм"})`
      : `состояние ${projection.state ?? response.status}`;
  } catch { /* Configuration validation works before the local web process starts. */ }

  console.log("Google Drive OAuth: CONFIG OK");
  console.log(`Соединение: ${connection}`);
  console.log("Секреты не выводились. Подключение выполняется кнопкой на дашборде.");
}

main().catch((error: unknown) => {
  const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  console.error(`Google Drive OAuth: FAIL (${code})`);
  console.error("Проверьте web/.runtime/runtime.env и web/.runtime/credentials; значения credentials в вывод не печатаются.");
  process.exitCode = 1;
});
