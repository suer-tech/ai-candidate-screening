import { chmod, lstat, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const PREFIXES = ["hh-media-processor-", "candidate-media-tool-", "hh-drive-source-"] as const;

function assertPrefix(prefix: string) {
  if (!PREFIXES.includes(prefix as (typeof PREFIXES)[number])) throw new Error("PRIVATE_TEMP_PREFIX_DENIED");
}

function isInside(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export async function createPrivateTemp(prefix: (typeof PREFIXES)[number]) {
  assertPrefix(prefix);
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  await chmod(directory, 0o700).catch(() => undefined);
  return directory;
}

export async function removePrivateTemp(directory: string) {
  const root = await realpath(tmpdir());
  const resolved = path.resolve(directory);
  if (!isInside(root, resolved) || !PREFIXES.some((prefix) => path.basename(resolved).startsWith(prefix))) {
    throw new Error("PRIVATE_TEMP_PATH_DENIED");
  }
  await rm(resolved, { recursive: true, force: true });
}

export async function recoverStalePrivateTemp(options: { olderThanMs?: number; nowMs?: number } = {}) {
  const root = await realpath(tmpdir());
  const olderThanMs = options.olderThanMs ?? 60 * 60 * 1000;
  const nowMs = options.nowMs ?? Date.now();
  let removed = 0;
  for (const name of await readdir(root)) {
    if (!PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    const candidate = path.resolve(root, name);
    if (!isInside(root, candidate)) continue;
    const metadata = await lstat(candidate).catch(() => null);
    if (!metadata || metadata.isSymbolicLink() || !metadata.isDirectory() || nowMs - metadata.mtimeMs < olderThanMs) continue;
    await removePrivateTemp(candidate);
    removed += 1;
  }
  return { scannedPrefixes: PREFIXES.length, removed };
}
