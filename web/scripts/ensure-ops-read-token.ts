import { randomBytes } from "node:crypto";
import { chmod, lstat, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

const root = process.env.HH_RUNTIME_CONFIG_ROOT?.trim()
  ? path.resolve(process.env.HH_RUNTIME_CONFIG_ROOT)
  : path.resolve(".runtime");
const target = path.join(root, "credentials", "internal-service-tokens.json");
const stat = await lstat(target);
if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("INTERNAL_SERVICE_TOKENS_UNSAFE");
const current = JSON.parse(await readFile(target, "utf8")) as Record<string, unknown>;
if (!current || typeof current !== "object" || Array.isArray(current)
  || Object.values(current).some((value) => typeof value !== "string" || value.length < 32)) {
  throw new Error("INTERNAL_SERVICE_TOKENS_INVALID");
}
if (typeof current.OPS_READ_INTERNAL_TOKEN === "string" && current.OPS_READ_INTERNAL_TOKEN.length >= 32) {
  console.log("OPS read token already exists; no credentials changed.");
  process.exit(0);
}
const temporary = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.new`;
const handle = await open(temporary, "wx", 0o600);
try { await handle.writeFile(`${JSON.stringify({ ...current, OPS_READ_INTERNAL_TOKEN: randomBytes(48).toString("base64url") })}\n`, "utf8"); }
finally { await handle.close(); }
try {
  await chmod(temporary, 0o600);
  await rename(temporary, target);
} catch (error) {
  await rm(temporary, { force: true });
  throw error;
}
console.log("OPS read token added; existing credentials were preserved and no values were printed.");
