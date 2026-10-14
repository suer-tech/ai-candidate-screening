import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function allowedPath(path) {
  if (typeof path !== "string" || !/^(web\/(server|app|tests)\/)/.test(path)
      || path.includes("\\") || path.includes(":") || path.includes("//")) return false;
  const parts = path.split("/");
  const blocked = new Set(["candidate", "credentials", "secrets", "fixtures", "evidence", "node_modules", "test-results", "playwright-report"]);
  return !parts.some(part => !part || part.startsWith(".") || blocked.has(part.toLowerCase()))
    && !/(secret|credential|\.env)/i.test(parts.at(-1)) && /\.(ts|tsx|mjs|js|json)$/.test(path);
}

export function validateChanges(changes) {
  if (!Array.isArray(changes) || changes.length < 1 || changes.length > 5) throw new Error("Expected 1-5 changed source files");
  const seen = new Set();
  for (const file of changes) {
    if (!file || !["A", "M"].includes(file.status) || !allowedPath(file.path) || seen.has(file.path)) throw new Error("Disallowed maintenance change");
    seen.add(file.path);
    if (file.symlink || typeof file.content !== "string" || file.content.includes("\0") || Buffer.byteLength(file.content, "utf8") > 500_000) throw new Error("Unsafe maintenance file");
    if (file.path.endsWith(".json")) JSON.parse(file.content);
  }
}

function main() {
  const base = process.env.HH_OPS_BASE_SHA || "HEAD^";
  const output = execFileSync("git", ["diff", "--name-status", "--no-renames", base, "HEAD"], { encoding: "utf8" });
  const changes = output.trim().split("\n").filter(Boolean).map(line => {
    const [status, path] = line.split("\t");
    if (!["A", "M"].includes(status) || !allowedPath(path)) throw new Error("Disallowed maintenance path or operation");
    const metadata = lstatSync(path);
    return { status, path, symlink: metadata.isSymbolicLink() || !metadata.isFile(), content: readFileSync(path, "utf8") };
  });
  validateChanges(changes);
  const diff = execFileSync("git", ["diff", "--no-ext-diff", base, "HEAD"], { encoding: "utf8", maxBuffer: 100_001 });
  if (diff.length > 50_000) throw new Error("Maintenance diff exceeds review budget");
  console.log(`Candidate maintenance policy passed for ${changes.length} files`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
