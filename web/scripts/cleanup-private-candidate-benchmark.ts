import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { DurableAssemblyAiAdapter } from "../server/candidate-pipeline/providers.ts";
import { environmentProjection, loadRuntimeConfiguration } from "../server/configuration/runtime.ts";
import { createGoogleDriveOAuthRuntime } from "../server/google-drive-oauth/runtime.ts";
import { createPostgresClient } from "../server/storage/postgres.ts";
import { cleanupPrivateBenchmarkOrphans } from "./private-benchmark-cleanup.ts";

type ReviewManifest = { schemaVersion: string; generatedAtUtc: string; runs: Array<{ runId: string; reviewDeadlineUtc: string; files: string[]; status: "GREEN" | "RED" | "FAILED" }> };

function readArg(name: string) {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

const webRoot = path.resolve(import.meta.dirname, "..");
const candidateRoot = path.resolve(webRoot, "../candidate");
const privateRoot = path.join(candidateRoot, ".benchmark-private");
const reviewRoot = path.join(privateRoot, "generated-review");
const reviewManifestPath = path.join(reviewRoot, "private-benchmark-review-manifest.local.json");
const webEvidence = path.join(webRoot, ".runtime", "evidence");
const finalize = process.argv.includes("--finalize-review");
const purgeAll = process.argv.includes("--purge-all");
const runIdArg = readArg("--run-id");
const dryRun = process.argv.includes("--dry-run");
const runReviewTTL = Number(process.env.PRIVATE_BENCHMARK_REVIEW_TTL_DAYS ?? "7");

async function readReviewManifest() {
  try {
    return JSON.parse(await readFile(reviewManifestPath, "utf8")) as ReviewManifest;
  } catch {
    return null;
  }
}
async function writeReviewManifest(manifest: ReviewManifest) {
  await mkdir(reviewRoot, { recursive: true });
  await writeFile(reviewManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}
function hashBytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

const configuration = await loadRuntimeConfiguration(webRoot);
const environment = environmentProjection(configuration);
const database = createPostgresClient({ url: environment.DATABASE_URL, max: 2 });
try {
  const oauth = createGoogleDriveOAuthRuntime({ database, environment });
  const result = await cleanupPrivateBenchmarkOrphans({
    database,
    drive: await oauth.drive(),
    provider: new DurableAssemblyAiAdapter({ apiKey: environment.ASSEMBLYAI_API_KEY }),
  });
  const manifest = await readReviewManifest();
  const reviewRootEntries = await readdir(reviewRoot).catch((): string[] => []);

  const now = Date.now();
  let reviewRunsKept = 0;
  let reviewRunsDeleted = 0;
  let reviewFilesKept = 0;
  let reviewFilesDeleted = 0;
  const reviewedManifestRuns: ReviewManifest["runs"] = [];

      if (manifest) {
        for (const item of manifest.runs) {
      const expired = new Date(item.reviewDeadlineUtc).getTime() <= now - 0;
      const targeted = !runIdArg || item.runId === runIdArg;
      const shouldDelete = purgeAll
        || (finalize && targeted && (expired || process.argv.includes("--allow-active-review")));
      if (shouldDelete) {
        if (dryRun) {
          reviewRunsDeleted += 1;
          reviewFilesDeleted += item.files.length;
          continue;
        }
        for (const file of item.files) {
          const fullPath = path.join(reviewRoot, item.runId, file);
          await rm(fullPath, { force: true });
          reviewFilesDeleted += 1;
        }
        if (reviewRootEntries.includes(item.runId)) await rm(path.join(reviewRoot, item.runId), { recursive: true, force: true });
        reviewRunsDeleted += 1;
      } else {
        reviewRunsKept += 1;
        reviewFilesKept += item.files.length;
        reviewedManifestRuns.push(item);
      }
    }
    manifest.generatedAtUtc = new Date().toISOString();
    manifest.runs = reviewedManifestRuns;
    if (!dryRun) await writeReviewManifest(manifest);
  }

  const evidence = {
    schemaVersion: "private-benchmark-cleanup-evidence/v1",
    capturedAtUtc: new Date().toISOString(),
    cleanupComplete: true,
    ...result,
    review: {
      manifestFound: Boolean(manifest),
      runsKept: reviewRunsKept,
      runsDeleted: reviewRunsDeleted,
      filesKept: reviewFilesKept,
      filesDeleted: reviewFilesDeleted,
      finalizeMode: finalize ? "requested" : "retain",
      dryRun,
      retentionDeadlineDays: Math.max(1, Number.isFinite(runReviewTTL) ? runReviewTTL : 7),
      manifestPath: manifest ? path.relative(webRoot, reviewManifestPath) : "missing",
    },
    privateReviewRetention: {
      pending: manifest ? manifest.runs.length : 0,
      canDelete: finalize ? !dryRun : false,
    },
    containsPersonalData: false,
    identifiersPrinted: 0,
    hashes: manifest ? { manifest: hashBytes(await readFile(reviewManifestPath)) } : {},
  };
  await mkdir(path.join(webRoot, ".runtime", "evidence"), { recursive: true });
  await writeFile(path.join(webEvidence, "private-benchmark-cleanup.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(evidence));
} finally {
  await database.end({ timeout: 5 });
}
