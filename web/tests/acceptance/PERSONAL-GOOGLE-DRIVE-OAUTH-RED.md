# TST-120 — independent personal Google Drive OAuth acceptance baseline

- Change: `support-personal-google-drive-oauth`
- Test author: independent acceptance subagent `/root/personal_drive_oauth_red`
- Recorded RED executor: independent acceptance subagent `/root/personal_drive_oauth_red`
- Independence declaration: the author/executor did not implement production OAuth, Drive adapter, runtime, or D1 schema code.
- Data: immutable synthetic fixture set `personal-google-drive-oauth-synthetic-v1`; no real Gmail account, candidate data, OAuth credentials, network call, or external spend.
- Related requirements: TST-120, TST-001–TST-007, TST-080–TST-085, GDO-001–GDO-008, modified SEC-003, INT-005 and TST-011.
- Cleanup: local RED creates no application, Google Drive, provider, or candidate state; provisioned execution must delete only its isolated synthetic tree.

## Executable cases

| ID | Purpose and essential expected result |
| --- | --- |
| TST-120-A | Start with personal OAuth only; service-account/Shared Drive backend configuration is rejected. |
| TST-120-B | Anonymous connect and callback are denied without creating OAuth operation state. |
| TST-120-C | Valid state/PKCE connects once; replay, expiry, PKCE mismatch and redirect poisoning fail before a second exchange. |
| TST-120-D | Refresh token is AES-GCM-enveloped, no plaintext token column exists, tamper fails, and credentials are absent from all observable surfaces. |
| TST-120-E | Local `testing` is warned/allowed; production `testing` fails with `GOOGLE_OAUTH_TESTING_GRANT_NOT_DURABLE`; production-personal passes. |
| TST-120-F | After loss of memory token and worker restart, one refresh resumes the checkpoint with no duplicate external effect. |
| TST-120-G | A manually added HR file below `Найм` is discovered; unrelated IDs are denied before the Drive API call. |
| TST-120-H | Timeout-after-create is reconciled before retry; exactly two PDFs remain and cleanup preserves HR source files. |
| TST-120-I | `invalid_grant` yields `REAUTH_REQUIRED` plus actionable `WAITING_FOR_HUMAN`, never generic terminal `FAILED`. |
| TST-120-J | Expected-account reconnect reconciles and resumes once; another Google subject is blocked; candidate/folders/version/PDF are not duplicated. |
| TST-120-K | Disconnect deletes the local durable grant even when remote revoke is unavailable, while product records and Drive files remain. |
| TST-120-L | Browser projection omits `testingExpiresAt` and any locally calculated seven-day date; HR UI does not call the connection «Тестовый OAuth» or render that date, while production readiness still rejects operator mode `testing`. |
| TST-120-M | A Drive executor permits one registered descendant only with a matching connection/root/candidate/input/operation tool grant; missing, wrong-root, wrong-operation and arbitrary client IDs are denied before Drive API. |
| TST-120-N | The durable Drive executor reaches the OAuth token provider and `GoogleMyDriveAdapter` only after grant, budget, checkpoint and outbox intent are durably established, producing one external effect. |
| TST-120-O | Runtime `invalid_grant` changes connection to `REAUTH_REQUIRED`, preserves checkpoint, blocks later Drive effects and stores typed task/run `WAITING_FOR_HUMAN` rather than `FAILED`. |
| TST-120-P | Expected-account reconnect emits one durable resume event for the original run and reconciles an unknown external outcome before retry/reuse without candidate/folder/version/PDF duplicates. |
| TST-120-Q | Production readiness requires valid config, refresh-envelope decrypt, active owner and real root read/write probes; each failed probe and operator `testing` blocks readiness, and static config alone is insufficient. |

Each case requires `status=SUCCEEDED`, synthetic-only evidence, `productionLikeAcceptanceClaimed=false`, and an automatic scan proving that authorization code, client secret, refresh token, access token, and PKCE verifier sentinels did not enter the result.

## Commands

From `web/`:

```powershell
# Local focused acceptance (expected RED before implementation)
npm run test:personal-drive-oauth

# Machine-readable controlled evidence (expected non-zero while any case is RED)
npm run test:personal-drive-oauth:evidence

# JUnit evidence for CI/readable test tooling
node --test --test-reporter=junit --test-reporter-destination=tests/acceptance/evidence/personal-google-drive-oauth-red.junit.xml tests/personal-google-drive-oauth.acceptance.test.mjs
```

Provisioned acceptance uses a separate Google Cloud test project, synthetic Gmail-owned root and immutable deployed build. It is never replaced by the controlled adapter:

```powershell
npm run e2e:preflight -- --json-output test-results/e2e-preflight.json
npm run e2e:required
```

The provisioned preflight must attest `production-personal`, exact HTTPS callback, active expected Gmail subject, refresh-after-restart, root read/write confinement and secret-free evidence. `testing`, controlled fixtures, skipped checks, a service account, or a local backend cannot support a production acceptance claim.

## Recorded actual results

### Initial OAuth implementation baseline

- Historical status: **RED (expected before production implementation)**.
- Actual at that point: all eleven original executable cases returned `NOT_IMPLEMENTED` because `server/google-drive-oauth/conformance.ts` was absent.
- Safe code: `GOOGLE_DRIVE_OAUTH_CONFORMANCE_ADAPTER_MISSING`.
- Evidence: `tests/acceptance/evidence/personal-google-drive-oauth-red.junit.xml` and `personal-google-drive-oauth-red.json`.

### Publishing-status truthfulness regression

- Command: `npm run test:personal-drive-oauth`.
- Status before the corrective production edit: **RED**, exit code `1`; 13 total, 11 passed, 2 failed.
- Projection failure: `projectGoogleDriveConnection` exposes a locally calculated `testingExpiresAt` (`connectedAt + 7 days`).
- UI failure: the rendered Drive monitor contains `Тестовый OAuth: доступ может истечь 27.08.2026`.
- Preserved behavior: the existing readiness scenario continues to pass and production mode `testing` remains blocked by `GOOGLE_OAUTH_TESTING_GRANT_NOT_DURABLE`.
- Evidence: `tests/acceptance/evidence/personal-google-drive-oauth-ui-red.junit.xml`; XML is valid and contains none of the synthetic client/envelope secret markers.
- Status: **RED (expected after GDO-005/GDO-007 were corrected and before production code followed them)**.

### Durable runtime and operational-readiness regression

- Command: `npm run test:personal-drive-oauth`.
- Status before tasks 5.6, 6.1–6.3 and 7.6: **RED**, exit code `1`; 18 total, 13 passed, 5 failed.
- Passing baseline: TST-120 A–L stays GREEN, including the publishing-status regression and primitive adapter/token/reconnect checks.
- RED cases: TST-120-M through TST-120-Q all return safe code `GOOGLE_DRIVE_OAUTH_SCENARIO_UNKNOWN`; production conformance therefore cannot yet prove runtime grants, durable executor wiring, durable escalation/resume ordering or operational readiness probes.
- Evidence: `tests/acceptance/evidence/personal-google-drive-oauth-runtime-red.junit.xml` and `personal-google-drive-oauth-runtime-red.json`.
- Evidence safety: JUnit XML is valid; both artifacts contain no OAuth code, client secret, refresh/access token or PKCE verifier sentinel and do not claim production-like acceptance.
- Cleanup: controlled cases create no external Drive/provider state; their fixtures are immutable synthetic operations.
