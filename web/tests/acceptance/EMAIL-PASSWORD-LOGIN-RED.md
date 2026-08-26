# Email/password login — RED acceptance evidence

- Change: `add-email-password-login-screen`
- Date: 2026-08-21
- Scope: OpenSpec tasks 1.1–1.3
- Production implementation changed before this run: no
- Fixture policy: synthetic-only; no real personal data, credentials, session tokens, CSRF secrets or plaintext source identifiers in evidence

## Command

```text
npm run test:auth
```

## Result

Expected RED confirmed: `8` tests executed, `0` passed, `8` failed.

1. `AUTH-ACC-001` — missing `runEmailPasswordAuthConformanceScenario`; credentials and forced password change are not implemented.
2. `AUTH-ACC-002` — missing auth boundary; 12-hour/30-day sessions, rotation, logout and revoke are not implemented.
3. `AUTH-ACC-003` — missing auth boundary; fail-closed route matrix and forged identity-header rejection are not implemented.
4. `AUTH-ACC-004` — missing auth boundary; same-origin session-bound CSRF and safe return path are not implemented.
5. `AUTH-ACC-005` — missing auth boundary; five-attempt sliding window, 15-minute lock and generic errors are not implemented.
6. `AUTH-ACC-006` — missing auth boundary; safe audit and host-only operator lifecycle are not implemented.
7. `AUTH-UI-001` — missing `runEmailPasswordLoginUiConformanceScenario`; gated synthetic login shell, themes, accessibility and product-fetch suppression are not implemented.
8. `AUTH-UI-002` — missing login UI boundary; forced-change-only shell is not implemented.

Machine-readable failure evidence is stored in `tests/acceptance/evidence/email-password-login-red.junit.xml`.

## Green boundary expected by the acceptance suite

- `server/auth/conformance.ts` exports `runEmailPasswordAuthConformanceScenario(fixture)` and exercises the real auth/domain/request-protection implementation.
- `app/auth/login-conformance.ts` exports `runEmailPasswordLoginUiConformanceScenario(fixture)` and observes the real server-gated login/forced-change UI without product API requests before full authentication.
- The tests remain part of the default `npm test` command through `npm run test:auth`.
