import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const included = [
  /^deploy\//,
  /^web\/(?:app|db|drizzle-postgres|public|scripts|server)\//,
  /^web\/(?:package(?:-lock)?\.json|tsconfig\.json|vite\.config\.ts|drizzle\.config\.ts|eslint\.config\.mjs)$/,
];

export async function sourceBuildId() {
  const { stdout } = await execute("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: repositoryRoot,
    encoding: "buffer",
    maxBuffer: 32 * 1024 * 1024,
  });
  const files = stdout.toString("utf8").split("\0").filter((entry) => entry && included.some((pattern) => pattern.test(entry))).sort();
  if (!files.length) throw new Error("BUILD_FINGERPRINT_INPUT_EMPTY");
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file).update("\0");
    try { hash.update(await readFile(path.join(repositoryRoot, file))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      hash.update("<deleted>");
    }
    hash.update("\0");
  }
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `local-${date}-${hash.digest("hex").slice(0, 16)}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(await sourceBuildId());
