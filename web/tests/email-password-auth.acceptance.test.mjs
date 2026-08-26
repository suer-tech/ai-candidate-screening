import assert from "node:assert/strict";
import test from "node:test";
import { syntheticAuthFixture, syntheticLoginUiFixture } from "./fixtures/email-password-auth/synthetic-conformance.mjs";
import { equal, every, includes, none, runAuthScenario, runLoginUiScenario, verify } from "./helpers/email-password-auth-conformance-harness.mjs";

function accept(result, checks) {
  const failures = verify(result, [
    equal("evidence.synthetic", true),
    equal("evidence.containsRealPersonalData", false),
    equal("evidence.containsCredentials", false),
    equal("evidence.containsSessionTokens", false),
    equal("evidence.containsCsrfSecrets", false),
    equal("evidence.containsPlaintextSourceIdentifiers", false),
    ...checks,
  ]);
  assert.equal(failures.length, 0, failures.join("\n"));
}

test("AUTH-ACC-001: closed password credentials and forced password change", async () => {
  const result = await runAuthScenario(syntheticAuthFixture);
  accept(result, [
    equal("status", "SUCCEEDED"), equal("credentials.publicRegistration", false),
    equal("credentials.canonicalEmail", syntheticAuthFixture.user.canonicalEmail), equal("credentials.uniqueCanonicalEmail", true),
    equal("credentials.passwordPolicy.minimumLength", 12), equal("credentials.hash.kdf", "scrypt"),
    equal("credentials.hash.memoryHard", true), equal("credentials.hash.uniqueSalt", true), equal("credentials.hash.versionedParameters", true),
    equal("credentials.plaintextStored", false), equal("credentials.browserStorageUsed", false),
    equal("forcedChange.productUiAllowedBeforeChange", false), equal("forcedChange.productApiAllowedBeforeChange", false),
    includes("forcedChange.allowedActionsBeforeChange", ["CHANGE_PASSWORD", "LOGOUT"]),
    equal("forcedChange.rotatedSessionAfterChange", true), equal("forcedChange.oldSessionsRevoked", true),
  ]);
});

test("AUTH-ACC-002: opaque sessions enforce 12 hours, remember 30 days, logout and revoke", async () => {
  const result = await runAuthScenario(syntheticAuthFixture);
  accept(result, [
    equal("sessions.token.entropyBits", 256), equal("sessions.token.opaque", true), equal("sessions.token.hashOnlyPersistence", true),
    equal("sessions.cookie.hostOnly", true), equal("sessions.cookie.httpOnly", true), equal("sessions.cookie.sameSite", "Lax"),
    equal("sessions.cookie.secureInProduction", true), equal("sessions.cookie.insecureOnlyForExplicitLoopback", true),
    equal("sessions.defaultAbsoluteTtlSeconds", 43_200), equal("sessions.rememberAbsoluteTtlSeconds", 2_592_000),
    equal("sessions.rotation.afterLogin", true), equal("sessions.rotation.afterPasswordChange", true),
    equal("sessions.expiredRejected", true), equal("sessions.logout.serverRevokedBeforeCookieClear", true),
    equal("sessions.logout.subsequentProductStatus", 401), equal("sessions.operatorRevokeAllInvalidatesActive", true),
    equal("sessions.disableUserInvalidatesActive", true),
  ]);
});

test("AUTH-ACC-003: product routes ignore forged identity headers and fail closed", async () => {
  const result = await runAuthScenario(syntheticAuthFixture);
  accept(result, [
    equal("routeProtection.browserWithoutSession.surface", "LOGIN_SHELL"), equal("routeProtection.apiWithoutSession.status", 401),
    equal("routeProtection.forgedIdentityHeaders.localAccepted", false), equal("routeProtection.forgedIdentityHeaders.vpsAccepted", false),
    every("routeProtection.productRoutes", "every browser/product route must reject forged headers without a valid session", (item) => item.protected === true && item.statusWithoutSession === 401 && item.statusWithForgedHeader === 401),
    includes("routeProtection.publicAllowlist", ["LOGIN_SHELL", "AUTH_LOGIN", "AUTH_SESSION", "AUTH_PASSWORD_CHANGE", "AUTH_LOGOUT"]),
    equal("routeProtection.googleDriveOauthRequiresFullSession", true), equal("routeProtection.productionE2eIdentityBypass", false),
  ]);
});

test("AUTH-ACC-004: browser mutations require same-origin session-bound CSRF proof", async () => {
  const result = await runAuthScenario(syntheticAuthFixture);
  accept(result, [
    equal("csrf.missingProof.status", 403), equal("csrf.missingProof.mutationApplied", false),
    equal("csrf.wrongOrigin.status", 403), equal("csrf.wrongHost.status", 403), equal("csrf.otherSessionProof.status", 403),
    equal("csrf.validSameOriginSessionProof.accepted", true), equal("csrf.proofBoundToSession", true),
    equal("returnPath.safePreserved", syntheticAuthFixture.safeReturnPath),
    every("returnPath.unsafeCases", "external, protocol-relative and scripted return paths must resolve to an internal default", (item) => item.rejected === true && item.destination === "/"),
  ]);
});

test("AUTH-ACC-005: five failures in 15 minutes lock email/source for 15 minutes with generic errors", async () => {
  const result = await runAuthScenario(syntheticAuthFixture);
  accept(result, [
    equal("loginDefense.limit.failures", 5), equal("loginDefense.limit.slidingWindowSeconds", 900),
    equal("loginDefense.limit.lockSeconds", 900), equal("loginDefense.limit.key", "CANONICAL_EMAIL_AND_SOURCE"),
    equal("loginDefense.limit.postgresDurable", true), equal("loginDefense.sixthAttempt.passwordVerified", false),
    equal("loginDefense.genericMessage", "Не удалось войти. Проверьте данные"),
    includes("loginDefense.failureKinds", ["UNKNOWN_EMAIL", "WRONG_PASSWORD", "DISABLED_USER", "LOCKED_PAIR"]),
    every("loginDefense.failureCases", "unknown, wrong-password, disabled and locked accounts must be indistinguishable", (item) => item.message === "Не удалось войти. Проверьте данные" && item.revealsAccountExistence === false),
    equal("loginDefense.unknownUserRunsComparableDummyScrypt", true),
  ]);
});

test("AUTH-ACC-006: security audit and operator lifecycle never expose secret material", async () => {
  const result = await runAuthScenario(syntheticAuthFixture);
  accept(result, [
    includes("audit.eventTypes", ["LOGIN_SUCCESS", "LOGIN_FAILURE", "LOGIN_BLOCKED", "LOGOUT", "PASSWORD_CHANGED", "USER_DISABLED", "SESSIONS_REVOKED"]),
    equal("audit.timestampsUtc", true), equal("audit.hasSafeActorAndTargetIdentifiers", true),
    equal("audit.containsPasswordOrHash", false), equal("audit.containsCookieOrSessionToken", false),
    equal("audit.containsCsrfSecret", false), equal("audit.containsPlaintextSource", false),
    includes("operator.commands", ["auth:create-user", "auth:reset-password", "auth:disable-user", "auth:enable-user", "auth:revoke-sessions"]),
    equal("operator.passwordReadInteractively", true), equal("operator.passwordInArgv", false),
    equal("operator.passwordInStdout", false), equal("operator.passwordInSourceFiles", false),
    equal("operator.resetForcesPasswordChange", true), equal("operator.resetRevokesSessions", true),
    equal("operator.disableRejectsLogin", true), equal("operator.disableRevokesSessions", true), equal("operator.enableRestoresLoginEligibility", true),
  ]);
});

test("AUTH-UI-001: unauthenticated shell is synthetic, accessible, themed and product-fetch free", async () => {
  const result = await runLoginUiScenario(syntheticLoginUiFixture);
  accept(result, [
    equal("status", "SUCCEEDED"), equal("gating.sessionCheckedBeforeProductMount", true),
    equal("gating.productUiMounted", false), none("gating.requestsBeforeAuthentication", syntheticLoginUiFixture.forbiddenProductRequests),
    equal("form.email.type", "email"), equal("form.email.autocomplete", "username"), equal("form.password.autocomplete", "current-password"),
    equal("form.showPasswordControl", true), equal("form.rememberControl", true), equal("form.loadingState", true),
    equal("form.genericError", "Не удалось войти. Проверьте данные"), equal("form.sessionExpiredFeedback", true),
    equal("form.forgotPasswordDirectsToOperatorWithoutEnumeration", true),
    equal("composition.ariaHidden", true), equal("composition.syntheticOnly", true),
    includes("composition.parts", ["CANDIDATE_CARD", "PROCESSING_STAGES", "AI_RESULT"]),
    includes("theme.supported", ["light", "dark"]), includes("responsive.layouts", ["desktop", "tablet", "mobile"]),
    equal("theme.textGlow", false), equal("accessibility.labelsPresent", true), equal("accessibility.visibleFocus", true),
    equal("accessibility.keyboardSubmit", true),
    includes("accessibility.tabOrder", ["EMAIL", "PASSWORD", "SHOW_PASSWORD", "REMEMBER", "SUBMIT", "FORGOT_PASSWORD"]),
  ]);
});

test("AUTH-UI-002: forced-change shell exposes only password change and logout", async () => {
  const result = await runLoginUiScenario(syntheticLoginUiFixture);
  accept(result, [
    equal("forcedChange.visible", true), equal("forcedChange.productNavigationVisible", false),
    equal("forcedChange.productRequests", 0), includes("forcedChange.actions", ["CHANGE_PASSWORD", "LOGOUT"]),
    equal("forcedChange.newPasswordMinimumLength", 12), equal("forcedChange.keyboardOperable", true),
  ]);
});
