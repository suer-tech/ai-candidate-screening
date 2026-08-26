import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

const configurationRoot = process.env.HH_RUNTIME_CONFIG_ROOT?.trim() ? path.resolve(process.env.HH_RUNTIME_CONFIG_ROOT) : path.resolve(".runtime");
const target = path.join(configurationRoot, "credentials", "google-oauth-keyring.json");
const rotate = process.argv.includes("--rotate");
await mkdir(path.dirname(target), { recursive: true });
const temporary = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.new`;
let keyring: { activeVersion: string; keys: Record<string, string> };
if (rotate) {
  keyring = JSON.parse(await readFile(target, "utf8")) as typeof keyring;
  const versions = Object.keys(keyring.keys).map((value) => /^v(\d+)$/.exec(value)).filter(Boolean).map((match) => Number(match![1]));
  const activeVersion = `v${Math.max(0, ...versions) + 1}`;
  keyring = { activeVersion, keys: { ...keyring.keys, [activeVersion]: randomBytes(32).toString("base64url") } };
} else {
  keyring = { activeVersion: "v1", keys: { v1: randomBytes(32).toString("base64url") } };
}
const handle = await open(temporary, "wx", 0o600);
try {
  await handle.writeFile(`${JSON.stringify(keyring)}\n`, { encoding: "utf8" });
} finally {
  await handle.close();
}
try {
  if (!rotate) {
    const reservation = await open(target, "wx", 0o600);
    await reservation.close();
  }
  await rename(temporary, target);
} catch (error) {
  await rm(temporary, { force: true });
  if (!rotate && (error as NodeJS.ErrnoException).code === "EEXIST") {
    console.log("Keyring уже существует: .runtime/credentials/google-oauth-keyring.json. Пересоздавать его не нужно.");
    console.log("Для намеренной ротации используйте npm run rotate:google-oauth-keyring только по runbook.");
    process.exit(0);
  }
  throw error;
}
console.log(`${rotate ? "Ротирован" : "Создан"} .runtime/credentials/google-oauth-keyring.json (значения ключей не выводятся).`);
