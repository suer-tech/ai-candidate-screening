import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { CREDENTIAL_ALLOWLIST, loadRuntimeConfiguration } from "../server/configuration/runtime.ts";
import { createPostgresClient } from "../server/storage/postgres.ts";

const webRoot = path.resolve(import.meta.dirname, "..");
const configuration = await loadRuntimeConfiguration(webRoot);
function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return value.length >= 8 ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(collectStrings);
  return [];
}
const sentinels = [...new Set(Object.values(configuration.credentials).flatMap((value) => {
  try { return [value, ...collectStrings(JSON.parse(value))]; } catch { return [value]; }
}).filter((value) => value.length >= 8))];
const scanRoots = ["app", "server", "scripts", "tests/acceptance/evidence", ".runtime/logs"];
const textExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".xml", ".md", ".log", ".env"]);
let filesScanned = 0;
let credentialLeaks = 0;

async function walk(relative: string): Promise<string[]> {
  const absolute = path.join(webRoot, relative);
  const metadata = await stat(absolute).catch(() => null);
  if (!metadata) return [];
  if (metadata.isFile()) return [absolute];
  const output: string[] = [];
  for (const name of await readdir(absolute)) output.push(...await walk(path.relative(webRoot, path.join(absolute, name))));
  return output;
}

for (const root of scanRoots) {
  for (const file of await walk(root)) {
    if (!textExtensions.has(path.extname(file).toLowerCase())) continue;
    const content = await readFile(file, "utf8").catch(() => "");
    filesScanned += 1;
    for (const sentinel of sentinels) if (content.includes(sentinel)) credentialLeaks += 1;
  }
}

const forbiddenDependencies = ["cloudflare:workers", "@cloudflare/vite-plugin", "wrangler", "miniflare"];
const dependencySources = await Promise.all(["package.json", "vite.config.ts"].map((file) => readFile(path.join(webRoot, file), "utf8")));
const legacyActiveSettings = forbiddenDependencies.filter((needle) => dependencySources.some((source) => source.toLowerCase().includes(needle)));

const credentialNames = (await readdir(path.join(webRoot, ".runtime", "credentials"))).sort();
const credentialLayoutExact = JSON.stringify(credentialNames) === JSON.stringify([...CREDENTIAL_ALLOWLIST].sort());

const database = createPostgresClient({ url: configuration.credentials["database-url"], max: 1, connectTimeoutSeconds: 5, idleTimeoutSeconds: 5 });
let databaseLeaks = 0;
let databaseColumnsScanned = 0;
try {
  const columns = await database<{ table_name: string; column_name: string }[]>`
    SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema='public' AND data_type IN ('text','character varying','json','jsonb')
    ORDER BY table_name,column_name`;
  for (const column of columns) {
    const table = database(column.table_name);
    const field = database(column.column_name);
    databaseColumnsScanned += 1;
    for (const sentinel of sentinels) {
      const rows = await database<{ matches: number }[]>`SELECT count(*)::integer AS matches FROM ${table} WHERE ${field}::text LIKE ${`%${sentinel}%`}`;
      databaseLeaks += rows[0]?.matches ?? 0;
    }
  }
} finally {
  await database.end({ timeout: 3 });
}

const safe = credentialLeaks === 0 && databaseLeaks === 0 && legacyActiveSettings.length === 0 && credentialLayoutExact;
console.log(JSON.stringify({ safe, filesScanned, databaseColumnsScanned, credentialLeaks, databaseLeaks, legacyActiveSettings: legacyActiveSettings.length,
  credentialLayoutExact, secretValuesPrinted: 0 }));
if (!safe) process.exitCode = 1;
