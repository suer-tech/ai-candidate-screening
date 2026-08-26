import { randomBytes } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";

const configurationRoot = process.env.HH_RUNTIME_CONFIG_ROOT?.trim() ? path.resolve(process.env.HH_RUNTIME_CONFIG_ROOT) : path.resolve(".runtime");
const target = path.join(configurationRoot, "credentials", "internal-service-tokens.json");
const rotate = process.argv.includes("--rotate");
const names = ["AGENT_RUNTIME_INTERNAL_TOKEN", "CANDIDATE_TOOL_INTERNAL_TOKEN", "MEDIA_PROCESSOR_TOKEN", "DOCUMENT_PROCESSOR_TOKEN", "E2E_PREFLIGHT_TOKEN", "E2E_CONTROL_TOKEN", "E2E_FIXTURE_CONTROL_TOKEN"];
await mkdir(path.dirname(target), { recursive: true });
const temporary = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.new`;
const handle = await open(temporary, "wx", 0o600);
try {
  await handle.writeFile(`${JSON.stringify(Object.fromEntries(names.map((name) => [name, randomBytes(48).toString("base64url")]))) }\n`, "utf8");
} finally { await handle.close(); }
try {
  if (!rotate) { const reservation = await open(target, "wx", 0o600); await reservation.close(); }
  await rename(temporary, target);
} catch (error) {
  await rm(temporary, { force: true });
  if (!rotate && (error as NodeJS.ErrnoException).code === "EEXIST") {
    console.log("Internal service tokens уже существуют; для намеренной ротации используйте npm run rotate:internal-service-tokens.");
    process.exit(0);
  }
  throw error;
}
console.log(`${rotate ? "Ротированы" : "Созданы"} internal service tokens (значения не выводятся).`);
