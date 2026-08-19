# AI Candidate Screening web application

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Email and name are intended for display or contact purposes.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build and run the local unit, contract, acceptance, and harness tests
- `npm run test:e2e-harness`: test E2E configuration and readiness logic only
- `npm run e2e:preflight`: verify provisioned production-like dependencies
- `npm run e2e:required`: run the four mandatory Playwright/Chromium scenarios
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Mandatory production E2E

The release harness and its external test-control contract are documented in
[`tests/e2e/README.md`](tests/e2e/README.md). It fails before browser execution
when identity, D1, R2, Google Drive, LLM, STT, controlled test gateway, Telegram,
or complete cleanup capability is missing. Local tests and demo data never
satisfy this gate.

## Runtime Integration Boundary

- `DB` is the required D1 application-data binding. Apply migrations from
  `drizzle/` before enabling product routes. Without it, workspace, dashboard,
  vacancy, lifecycle, and result routes fail explicitly instead of using demo
  state.
- `GOOGLE_DRIVE_HEALTHCHECK_URL` is a server-only endpoint used by the dashboard
  every 15 seconds to verify the real Drive integration. If it is absent or the
  probe fails, the UI reports `Нет подключения` rather than inferring health
  from browser connectivity.
- `GOOGLE_DRIVE_HEALTHCHECK_TOKEN` is an optional server-only bearer credential
  for that probe. Do not expose either value to client code or commit real
  credentials.
- `GOOGLE_DRIVE_VACANCY_FOLDER_URL` must implement idempotent folder provisioning
  using the supplied `Idempotency-Key`; its response contains one `folderId`.
- `GOOGLE_DRIVE_RESULT_PDF_URL` must return the immutable PDF selected by the
  server-side `storageId`. The corresponding `*_TOKEN` values are server-only.
- `PROTECTED_LLM_TRACES` is a separate R2-compatible binding for protected LLM
  traces. It must not be exposed to the HR request role.
- `LLM_RUNTIME_CONFIG_JSON` contains only non-secret provider/capability mapping.
  Each configured `secretReference` names a separately injected runtime secret.
- `E2E_PREFLIGHT_TOKEN` protects the authenticated `/api/readiness/e2e` route.
  The route checks D1 migrations, R2, Drive permissions, LLM configuration, and
  real LLM/STT smoke endpoints without returning secret values.
- `E2E_LLM_SMOKE_URL`, `E2E_LLM_SMOKE_TOKEN`, `E2E_STT_SMOKE_URL`, and
  `E2E_STT_SMOKE_TOKEN` are server-only production-readiness probes. The STT
  check also requires `ASSEMBLYAI_API_KEY`.
- See `server/llm/README.md` for the non-secret LLM configuration, runtime
  secret, and protected trace-store boundaries.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
