import assert from "node:assert/strict";
import test from "node:test";
import { verifyRelease } from "../../web/scripts/hh-ops-verify-release.mjs";

const REPO = "suer-tech/ai-candidate-screening";
const PROPOSAL_ID = "abcdef12";
const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const MERGE_SHA = "c".repeat(40);

function fixture() {
  return {
    pr: {
      number: 7, state: "closed", merged: true, merge_commit_sha: MERGE_SHA,
      head: { ref: `codex/ops-${PROPOSAL_ID}`, sha: HEAD_SHA, repo: { full_name: REPO } },
      base: { ref: "production", sha: BASE_SHA, repo: { full_name: REPO } },
    },
    ref: { object: { sha: MERGE_SHA } },
    options: {
      sha: MERGE_SHA, proposalId: PROPOSAL_ID, prNumber: 7, repo: REPO,
      checks: [{ name: "validate-hh", head_sha: HEAD_SHA, status: "completed", conclusion: "success", app: { slug: "github-actions" } }],
      files: [{ filename: "web/server/candidate-pipeline/example.ts", status: "modified" }, { filename: "web/tests/example.test.mjs", status: "added" }],
      headCommit: { sha: HEAD_SHA, parents: [{ sha: BASE_SHA }] },
    },
  };
}

function verifies(value) { return verifyRelease(value.pr, value.ref, value.options); }

test("HH-OPS-RELEASE: permits only a merged reviewed candidate PR on the current production SHA", () => {
  assert.doesNotThrow(() => verifies(fixture()));
});

for (const [label, mutate] of [
  ["missing exact SHA", (f) => { f.options.sha = undefined; }],
  ["abbreviated SHA", (f) => { f.options.sha = MERGE_SHA.slice(0, 8); }],
  ["nonhex SHA", (f) => { f.options.sha = "z".repeat(40); }],
  ["malformed proposal ID", (f) => { f.options.proposalId = "../other"; }],
  ["different proposal branch", (f) => { f.pr.head.ref = "codex/ops-deadbeef"; }],
  ["unmerged PR", (f) => { f.pr.merged = false; }],
  ["different merge SHA", (f) => { f.pr.merge_commit_sha = "d".repeat(40); }],
  ["production branch moved", (f) => { f.ref.object.sha = "d".repeat(40); }],
  ["different PR number", (f) => { f.pr.number = 8; }],
  ["forked head repository", (f) => { f.pr.head.repo.full_name = "attacker/fork"; }],
  ["different destination repository", (f) => { f.options.repo = "suer-tech/OCR_document_reader"; }],
  ["different base branch", (f) => { f.pr.base.ref = "main"; }],
  ["missing reviewed head SHA", (f) => { delete f.pr.head.sha; }],
  ["different check head SHA", (f) => { f.options.checks[0].head_sha = "d".repeat(40); }],
  ["missing CI", (f) => { f.options.checks = []; }],
  ["different CI job", (f) => { f.options.checks[0].name = "validate"; }],
  ["unfinished CI", (f) => { f.options.checks[0].status = "in_progress"; }],
  ["failed CI", (f) => { f.options.checks[0].conclusion = "failure"; }],
  ["skipped CI", (f) => { f.options.checks[0].conclusion = "skipped"; }],
  ["check impersonating GitHub Actions", (f) => { f.options.checks[0].app.slug = "untrusted-app"; }],
  ["deleted file", (f) => { f.options.files[0].status = "removed"; }],
  ["renamed file", (f) => { f.options.files[0].status = "renamed"; }],
  ["missing changed files", (f) => { f.options.files = []; }],
  ["more than five changed files", (f) => { f.options.files = Array.from({ length: 6 }, (_, index) => ({ filename: `web/server/file${index}.ts`, status: "modified" })); }],
  ["policy script changed by the proposal", (f) => { f.options.files[0].filename = "web/scripts/hh-ops-policy.mjs"; }],
  ["deployment script changed by the proposal", (f) => { f.options.files[0].filename = "deploy/ops/deploy-approved.sh"; }],
  ["release workflow changed by the proposal", (f) => { f.options.files[0].filename = ".github/workflows/hh-production-deploy.yml"; }],
  ["candidate fixture changed by the proposal", (f) => { f.options.files[0].filename = "web/tests/fixtures/candidate.json"; }],
]) {
  test(`HH-OPS-RELEASE: refuses ${label} before host deployment`, () => {
    const value = fixture();
    mutate(value);
    assert.throws(() => verifies(value));
  });
}

test("HH-OPS-RELEASE: a green unrelated check cannot hide a failed required job", () => {
  const value = fixture();
  value.options.checks.push({ ...value.options.checks[0], conclusion: "failure" });
  value.options.checks.push({ ...value.options.checks[0], name: "unrelated-check", conclusion: "success" });
  assert.throws(() => verifies(value));
});

test("HH-OPS-RELEASE: malformed GitHub metadata fails closed", () => {
  for (const value of [null, {}, { ...fixture(), pr: null }, { ...fixture(), ref: null }]) {
    assert.throws(() => verifies(value));
  }
});
