import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { allowedPath } from "./hh-ops-policy.mjs";

export function verifyRelease(pr, ref, { sha, proposalId, prNumber, repo, checks, files }) {
  if (repo !== "suer-tech/ai-candidate-screening" || !/^[a-f0-9]{40}$/.test(sha || "") || !/^[a-f0-9]{8}$/.test(proposalId || "")
      || !Number.isInteger(prNumber) || prNumber < 1) throw new Error("Invalid approved release identity");
  if (!pr || pr.merged !== true || pr.merge_commit_sha !== sha || (pr.number !== undefined && pr.number !== prNumber)
      || pr.head?.ref !== `codex/ops-${proposalId}` || pr.head?.repo?.full_name !== repo
      || !/^[a-f0-9]{40}$/.test(pr.head?.sha || "") || pr.base?.ref !== "production" || ref?.object?.sha !== sha) {
    throw new Error("Release differs from approved merged candidate PR or current production branch");
  }
  const runs = Array.isArray(checks) ? checks : checks?.check_runs;
  const gate = runs?.filter(check => check.name === "validate-hh" && check.app?.slug === "github-actions");
  if (!gate?.length || gate.some(check => check.status !== "completed" || check.conclusion !== "success" || check.head_sha !== pr.head.sha)) throw new Error("Exact reviewed revision has no successful candidate CI");
  if (!Array.isArray(files) || files.length < 1 || files.length > 5 || new Set(files.map(file => file.filename)).size !== files.length
      || files.some(file => !["added", "modified"].includes(file.status) || !allowedPath(file.filename))) throw new Error("PR includes disallowed maintenance files");
}

async function github(path) {
  const response = await fetch(`https://api.github.com/repos/suer-tech/ai-candidate-screening${path}`, {
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN || ""}`, Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Release verification GitHub HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const sha = process.env.OPS_RELEASE_SHA;
  const proposalId = process.env.OPS_PROPOSAL_ID;
  const prNumber = Number(process.env.OPS_PR_NUMBER);
  const pr = await github(`/pulls/${prNumber}`);
  const ref = await github("/git/ref/heads/production");
  const checks = await github(`/commits/${pr.head.sha}/check-runs?check_name=validate-hh&filter=latest&per_page=100`);
  const files = await github(`/pulls/${prNumber}/files?per_page=100`);
  verifyRelease(pr, ref, { sha, proposalId, prNumber, repo: process.env.GITHUB_REPOSITORY, checks, files });
  console.log(`Verified candidate release ${sha.slice(0, 8)} from PR #${prNumber}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
