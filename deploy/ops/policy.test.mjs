import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateChanges } from "../../web/scripts/hh-ops-policy.mjs";

const changed = (path, overrides = {}) => ({ status: "M", path, content: "export const synthetic = 2;\n", ...overrides });

test("HH-OPS-POLICY: a bounded candidate-service fix accepts source and tests only", () => {
  assert.doesNotThrow(() => validateChanges([
    changed("web/server/candidate-pipeline/example.ts"),
    changed("web/app/example.tsx"),
    changed("web/tests/example.test.mjs", { status: "A" }),
    changed("web/server/example.js"),
    changed("web/app/example.json", { content: '{"synthetic":true}' }),
  ]));
});

for (const path of [
  "web/package.json", "web/package-lock.json", "web/scripts/hh-ops-policy.mjs",
  "web/scripts/hh-ops-verify-release.mjs", ".github/workflows/hh-production-deploy.yml",
  "deploy/ops/deploy-approved.sh", "deploy/ubuntu/install.sh", "docs/ARCHITECTURE.md",
  "web/.runtime/runtime.env", "web/.runtime/credentials/key.json", "web/server/.env",
  "web/server/secrets/key.json", "web/server/credentials/key.json", "web/server/candidate/person.json",
  "web/tests/fixtures/candidate.json", "web/tests/acceptance/evidence/result.json",
  "web/tests/evidence/result.json", "candidate/person.json", "web/tests/person.pdf",
  "web/server/source.ts/../../secrets.json", "/web/server/example.ts", "web\\server\\example.ts",
  "web//server/example.ts", "C:/web/server/example.ts", "web/server/./example.ts",
  "web/server/.hidden/example.ts", "web/server/example.py",
]) {
  test(`HH-OPS-POLICY: rejects protected or escaped path ${path}`, () => {
    assert.throws(() => validateChanges([changed(path)]));
  });
}

test("HH-OPS-POLICY: deletion, rename and symlink cannot enter an approved patch", () => {
  for (const status of ["D", "R100", "C100", "T", "U", "deleted", "renamed"]) {
    assert.throws(() => validateChanges([changed("web/server/example.ts", { status })]), `unsafe status accepted: ${status}`);
  }
  assert.throws(() => validateChanges([changed("web/server/example.ts", { symlink: true })]));
});

test("HH-OPS-POLICY: rejects empty, oversized and malformed proposals", () => {
  assert.throws(() => validateChanges([]));
  assert.throws(() => validateChanges(Array.from({ length: 6 }, (_, index) => changed(`web/server/file${index}.ts`))));
  for (const value of [null, undefined, {}, "web/server/example.ts", [null], [changed("web/server/example.ts", { content: null })]]) {
    assert.throws(() => validateChanges(value));
  }
});

test("HH-OPS-POLICY: file limit is byte based and permits a small fix in the existing large runtime", () => {
  assert.doesNotThrow(() => validateChanges([changed("web/server/candidate-pipeline/production-runtime.ts", { content: "x".repeat(220_000) })]));
  assert.doesNotThrow(() => validateChanges([changed("web/server/example.ts", { content: "x".repeat(500_000) })]));
  assert.throws(() => validateChanges([changed("web/server/example.ts", { content: "x".repeat(500_001) })]));
  assert.throws(() => validateChanges([changed("web/server/example.ts", { content: "я".repeat(250_001) })]), "UTF-8 bytes cannot bypass the file limit");
});

test("HH-OPS-POLICY: duplicate file identities cannot inflate a reviewable proposal", () => {
  assert.throws(() => validateChanges([changed("web/server/example.ts"), changed("web/server/example.ts", { status: "A" })]));
});

test("HH-OPS-POLICY: invalid JSON and binary content cannot be published as source", () => {
  assert.throws(() => validateChanges([changed("web/app/example.json", { content: '{"unfinished":' })]));
  assert.throws(() => validateChanges([changed("web/server/example.ts", { content: "synthetic\0binary" })]));
});

for (const oversized of [false, true]) {
  test(`HH-OPS-POLICY-CLI: ${oversized ? "rejects a diff over the review budget" : "accepts a real bounded Git diff"}`, (t) => {
    const parent = resolve(tmpdir());
    const root = mkdtempSync(join(parent, "hh-ops-policy-test-"));
    t.after(() => {
      assert.equal(dirname(root), parent);
      assert.ok(root.includes("hh-ops-policy-test-"));
      rmSync(root, { recursive: true, force: true });
    });
    const source = join(root, "web/server/example.ts");
    mkdirSync(dirname(source), { recursive: true });
    writeFileSync(source, "export const synthetic = 1;\n");
    const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
    const commit = () => {
      git("add", ".");
      git("-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.invalid", "commit", "-m", "synthetic change");
    };
    git("init");
    commit();
    const base = git("rev-parse", "HEAD");
    writeFileSync(source, oversized ? "// synthetic line\n".repeat(3100) : "export const synthetic = 2;\n");
    commit();
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../../web/scripts/hh-ops-policy.mjs", import.meta.url))], {
      cwd: root, encoding: "utf8", windowsHide: true, env: { ...process.env, HH_OPS_BASE_SHA: base },
    });
    assert.ifError(result.error);
    if (oversized) {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /diff exceeds review budget/i);
    } else {
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /passed for 1 files/);
    }
  });
}
