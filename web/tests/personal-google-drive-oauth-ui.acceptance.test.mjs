import assert from "node:assert/strict";
import test from "node:test";
import { googleOAuthReadiness } from "../server/google-drive-oauth/configuration.ts";
import { projectGoogleDriveConnection } from "../server/google-drive-oauth/oauth-service.ts";
import { loadDriveDashboardHarness } from "./helpers/react-component-harness.mjs";

const connectedAt = "2026-08-20T00:00:00.000Z";
const computedSevenDayDate = "2026-08-27T00:00:00.000Z";

const testingConnection = {
  id: "gdo-connection-ui-synthetic-001",
  state: "CONNECTED",
  ownerSubject: "google-subject-ui-synthetic-owner",
  ownerEmail: "synthetic.ui.owner@example.invalid",
  scopes: ["https://www.googleapis.com/auth/drive"],
  rootFolderId: "drive-root-ui-synthetic-001",
  rootFolderName: "Найм",
  deploymentMode: "testing",
  refreshTokenEnvelope: {
    ciphertext: "synthetic-envelope-ciphertext",
    nonce: "synthetic-envelope-nonce",
    tag: "synthetic-envelope-tag",
    keyVersion: "synthetic-key-v1",
  },
  connectedAt,
  lastRefreshAt: connectedAt,
  revision: 1,
};

function visibleText(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(visibleText).join(" ");
  if (typeof node === "object") return visibleText(node.props?.children);
  return "";
}

test("TST-120-L: browser status projection does not invent Google publishing status or grant expiry", () => {
  const projection = projectGoogleDriveConnection(testingConnection);
  const serialized = JSON.stringify(projection);

  assert.equal(Object.hasOwn(projection, "testingExpiresAt"), false, "browser projection must not expose a locally calculated testingExpiresAt");
  assert.doesNotMatch(serialized, new RegExp(computedSevenDayDate.replaceAll(".", "\\.")), "browser projection must not contain the connectedAt + 7 days value");

  const productionTesting = googleOAuthReadiness({
    E2E_ENVIRONMENT: "production",
    GOOGLE_OAUTH_CLIENT_ID: "synthetic-client-id",
    GOOGLE_OAUTH_CLIENT_SECRET: "synthetic-client-secret",
    GOOGLE_OAUTH_REDIRECT_URI: "https://hiring.example.invalid/api/integrations/google-drive/oauth/callback",
    GOOGLE_OAUTH_DEPLOYMENT_MODE: "testing",
  });
  assert.equal(productionTesting.ready, false);
  assert.equal(productionTesting.code, "GOOGLE_OAUTH_TESTING_GRANT_NOT_DURABLE");
});

test("TST-120-L: HR UI ignores unverified testing status and calculated seven-day date", async () => {
  const harness = await loadDriveDashboardHarness();
  try {
    const tree = harness.create({
      driveConnection: {
        ...projectGoogleDriveConnection(testingConnection),
        testingExpiresAt: computedSevenDayDate,
      },
      countdown: 15,
      onConnectDrive() {},
      onDisconnectDrive() {},
      onOpen() {},
      onNavigate() {},
      onQueueFilter() {},
    }).render();
    const text = visibleText(tree);

    assert.doesNotMatch(text, /Тестовый OAuth/i, "UI must not present the operator flag as verified Google Publishing status");
    assert.doesNotMatch(text, /через\s+7\s+дн/i, "UI must not invent a seven-day lifetime");
    assert.doesNotMatch(text, /27[./]08[./]2026/, "UI must not render the locally calculated expiry date");
  } finally {
    await harness.cleanup();
  }
});

