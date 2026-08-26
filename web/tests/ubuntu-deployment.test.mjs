import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const deploymentRoot = path.resolve(import.meta.dirname, "../../deploy/ubuntu");

test("Ubuntu ingress delegates authentication to app sessions and clears legacy identity", async () => {
  const [nginx, preflight, installer] = await Promise.all([
    readFile(path.join(deploymentRoot, "nginx-hh-web.conf"), "utf8"),
    readFile(path.join(deploymentRoot, "production-preflight.sh"), "utf8"),
    readFile(path.join(deploymentRoot, "install.sh"), "utf8"),
  ]);
  assert.doesNotMatch(nginx, /auth_basic/);
  assert.match(nginx, /proxy_set_header\s+oai-authenticated-user-id\s+""/);
  assert.match(nginx, /proxy_set_header\s+oai-authenticated-user-email\s+""/);
  assert.match(preflight, /AUTH_MODE_NOT_READY/);
  assert.match(preflight, /PRODUCTION_TEST_IDENTITY_BYPASS_REJECTED/);
  assert.match(preflight, /NGINX_LEGACY_AUTH_PRESENT/);
  assert.match(preflight, /PUBLIC_ORIGIN_NOT_CONFIGURED/);
  assert.match(preflight, /GOOGLE_REDIRECT_ORIGIN_MISMATCH/);
  assert.match(preflight, /NGINX_TLS_OR_CONFIG_INVALID/);
  assert.doesNotMatch(installer, /apache2-utils|nginx\.htpasswd/);
  assert.match(installer, /public\.example\.org/);
});

test("Ubuntu processor URLs match their loopback listeners and production routes", async () => {
  const source = await readFile(path.join(deploymentRoot, "runtime.env.example"), "utf8");
  assert.match(source, /^MEDIA_PROCESSOR_URL=http:\/\/127\.0\.0\.1:4311\/v1\/extract-audio$/m);
  assert.match(source, /^MEDIA_PROCESSOR_PORT=4311$/m);
  assert.match(source, /^DOCUMENT_PROCESSOR_URL=http:\/\/127\.0\.0\.1:4312\/v1\/extract-document$/m);
  assert.match(source, /^DOCUMENT_PROCESSOR_PORT=4312$/m);
});
