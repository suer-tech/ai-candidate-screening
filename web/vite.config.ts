import { nitro } from "nitro/vite";
import vinext from "vinext";
import { defineConfig } from "vite";

function localAuthPlugin() {
  const enabled = process.env.E2E_ENVIRONMENT === "local" && Boolean(process.env.LOCAL_AUTH_USER_ID);
  return {
    name: "hh-local-auth",
    configureServer(server: { middlewares: { use(handler: (request: { headers: Record<string, string | string[] | undefined> }, response: unknown, next: () => void) => void): void } }) {
      if (!enabled) return;
      server.middlewares.use((request, _response, next) => {
        request.headers["oai-authenticated-user-id"] ??= process.env.LOCAL_AUTH_USER_ID!;
        request.headers["oai-authenticated-user-email"] ??= process.env.LOCAL_AUTH_USER_EMAIL ?? "local-hr@example.invalid";
        request.headers["oai-authenticated-user-full-name"] ??= encodeURIComponent(process.env.LOCAL_AUTH_USER_FULL_NAME ?? "Локальный HR");
        request.headers["oai-authenticated-user-full-name-encoding"] ??= "percent-encoded-utf-8";
        next();
      });
    },
  };
}

export default defineConfig({
  server: process.env.CODEX_SANDBOX === "seatbelt" ? { watch: { useFsEvents: false, usePolling: true } } : undefined,
  plugins: [localAuthPlugin(), vinext(), nitro({ preset: "node" })],
});
