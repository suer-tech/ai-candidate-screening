import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

type PrivateValue = null | string | number | boolean | { $bytesBase64: string } | PrivateValue[] | { [key: string]: PrivateValue };
type ExportedTable = { name: string; rows: Array<Record<string, PrivateValue>> };
type ExportedObject = { sourceKeyHash: string; blobFile: string; checksum: string; byteSize: number; contentType: string;
  retentionUntilUtc?: string; protected: boolean; traceId?: string };

const webRoot = path.resolve(import.meta.dirname, "..");
const stateRoot = path.join(webRoot, ".wrangler", "state");
const requestedOutput = process.argv.find((value) => value.startsWith("--output="))?.slice("--output=".length);
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputRoot = requestedOutput ? path.resolve(webRoot, requestedOutput) : path.join(webRoot, ".runtime", "migration", timestamp);

function checksum(value: Uint8Array | string) { return createHash("sha256").update(value).digest("hex"); }
function quoted(name: string) { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error("LEGACY_IDENTIFIER_INVALID"); return `"${name}"`; }
function stable(value: unknown): unknown {
  if (value instanceof Uint8Array) return { $bytesBase64: Buffer.from(value).toString("base64") };
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, stable(entry)]));
  if (["string", "number", "boolean"].includes(typeof value) || value === null) return value;
  return String(value);
}
function normalizeRow(row: Record<string, unknown>): Record<string, PrivateValue> {
  return Object.fromEntries(Object.entries(row).map(([key, original]) => {
    let value = original;
    if (typeof value === "string" && /(?:^|_)json$|_json$/i.test(key)) {
      try { value = JSON.stringify(stable(JSON.parse(value))); } catch { /* Preserve a non-JSON legacy value for explicit importer validation. */ }
    }
    return [key, stable(value) as PrivateValue];
  }));
}
async function filesUnder(root: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return (await Promise.all(entries.map(async (entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? filesUnder(target) : [target];
  }))).flat();
}
function tableNames(database: DatabaseSync) {
  return database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map((row) => String(row.name)).filter((name) => !name.startsWith("_cf_"));
}
async function selectD1Database() {
  const files = (await filesUnder(stateRoot)).filter((file) => /[\\/]d1[\\/].*\.sqlite$/i.test(file) && path.basename(file) !== "metadata.sqlite");
  const candidates = [];
  for (const file of files) {
    const database = new DatabaseSync(file, { readOnly: true });
    try {
      database.exec("PRAGMA query_only=ON");
      const tables = tableNames(database);
      let rows = 0;
      for (const name of tables) rows += Number(database.prepare(`SELECT COUNT(*) AS count FROM ${quoted(name)}`).get()?.count ?? 0);
      candidates.push({ file, tableCount: tables.length, rows, modified: (await stat(file)).mtimeMs });
    } finally { database.close(); }
  }
  candidates.sort((left, right) => right.tableCount - left.tableCount || right.rows - left.rows || right.modified - left.modified || left.file.length - right.file.length);
  if (!candidates[0]) throw new Error("LEGACY_D1_DATABASE_NOT_FOUND");
  return candidates[0];
}
async function exportD1(file: string) {
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    database.exec("PRAGMA query_only=ON");
    const tables: ExportedTable[] = [];
    for (const name of tableNames(database)) {
      const rows = database.prepare(`SELECT * FROM ${quoted(name)}`).all().map((row) => normalizeRow(row as Record<string, unknown>));
      tables.push({ name, rows });
    }
    return tables;
  } finally { database.close(); }
}
async function selectR2Database() {
  const files = (await filesUnder(stateRoot)).filter((file) => /[\\/]r2[\\/].*\.sqlite$/i.test(file) && path.basename(file) !== "metadata.sqlite");
  const candidates: Array<{ file: string; count: number }> = [];
  for (const file of files) {
    const database = new DatabaseSync(file, { readOnly: true });
    try {
      const exists = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='_mf_objects'").get();
      if (exists) candidates.push({ file, count: Number(database.prepare("SELECT COUNT(*) AS count FROM _mf_objects").get()?.count ?? 0) });
    } finally { database.close(); }
  }
  candidates.sort((left, right) => right.count - left.count || left.file.length - right.file.length);
  return candidates[0];
}
async function exportR2(databaseFile: string | undefined) {
  if (!databaseFile) return [] as ExportedObject[];
  const allFiles = await filesUnder(stateRoot);
  const blobByName = new Map(allFiles.filter((file) => path.basename(path.dirname(file)) === "blobs").map((file) => [path.basename(file), file]));
  const database = new DatabaseSync(databaseFile, { readOnly: true });
  try {
    database.exec("PRAGMA query_only=ON");
    const rows = database.prepare("SELECT key,blob_id,size,http_metadata,custom_metadata FROM _mf_objects ORDER BY key").all() as Array<Record<string, unknown>>;
    const objects: ExportedObject[] = [];
    await mkdir(path.join(outputRoot, "blobs"), { recursive: true });
    for (const [index, row] of rows.entries()) {
      const source = blobByName.get(String(row.blob_id));
      if (!source) throw new Error("LEGACY_R2_BLOB_MISSING");
      const bytes = await readFile(source);
      if (bytes.byteLength !== Number(row.size)) throw new Error("LEGACY_R2_SIZE_MISMATCH");
      const blobFile = `blobs/${String(index + 1).padStart(4, "0")}.bin`;
      await copyFile(source, path.join(outputRoot, blobFile));
      const http = JSON.parse(String(row.http_metadata || "{}")) as Record<string, unknown>;
      const custom = JSON.parse(String(row.custom_metadata || "{}")) as Record<string, unknown>;
      let traceId: string | undefined;
      try {
        const body = JSON.parse(bytes.toString("utf8")) as { correlation?: { traceId?: string } };
        if (typeof body.correlation?.traceId === "string") traceId = body.correlation.traceId;
      } catch { /* Non-JSON legacy objects remain generic protected blobs. */ }
      objects.push({ sourceKeyHash: checksum(String(row.key)), blobFile, checksum: checksum(bytes), byteSize: bytes.byteLength,
        contentType: typeof http.contentType === "string" ? http.contentType : "application/octet-stream",
        retentionUntilUtc: typeof custom.expiresAt === "string" ? custom.expiresAt : undefined, protected: true, traceId });
    }
    return objects;
  } finally { database.close(); }
}

await mkdir(outputRoot, { recursive: true });
const selectedD1 = await selectD1Database();
const selectedR2 = await selectR2Database();
const tables = await exportD1(selectedD1.file);
const objects = await exportR2(selectedR2?.file);
const manifest = {
  version: "legacy-d1-r2-export/v1", exportedAtUtc: new Date().toISOString(),
  source: { d1Checksum: checksum(await readFile(selectedD1.file)), r2MetadataChecksum: selectedR2 ? checksum(await readFile(selectedR2.file)) : null },
  tables, objects,
};
await writeFile(path.join(outputRoot, "legacy-state.private.json"), JSON.stringify(manifest), { encoding: "utf8", mode: 0o600 });
const evidence = { version: manifest.version, tableCount: tables.length, nonemptyTables: tables.filter((table) => table.rows.length).length,
  totalRows: tables.reduce((total, table) => total + table.rows.length, 0), objectCount: objects.length,
  objectBytes: objects.reduce((total, object) => total + object.byteSize, 0), sourceFingerprintsPresent: true, containsRowValues: false,
  containsObjectNames: false, containsObjectBytes: false };
await writeFile(path.join(outputRoot, "export-evidence.json"), JSON.stringify(evidence, null, 2), { encoding: "utf8", mode: 0o600 });
console.log(JSON.stringify({ ready: true, output: path.relative(webRoot, outputRoot).replaceAll("\\", "/"), ...evidence }));
