import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { environmentProjection, loadRuntimeConfiguration } from "../server/configuration/runtime.ts";
import { connectionTokenAad, decryptSecret, parseGoogleOAuthKeyring } from "../server/google-drive-oauth/crypto.ts";
import { PostgresGoogleDriveOAuthRepository } from "../server/google-drive-oauth/postgres-repository.ts";
import { createGoogleDriveOAuthRuntime } from "../server/google-drive-oauth/runtime.ts";
import { PostgresProductRepository } from "../server/product/postgres-repository.ts";
import { assertMigrationsCurrent } from "../server/storage/migrations.ts";
import { createPostgresClient, withTransaction, type PostgresClient } from "../server/storage/postgres.ts";

type PrivateValue = null | string | number | boolean | { $bytesBase64: string } | PrivateValue[] | { [key: string]: PrivateValue };
type Manifest = { version: string; tables: Array<{ name: string; rows: Array<Record<string, PrivateValue>> }>;
  objects: Array<{ sourceKeyHash: string; blobFile: string; checksum: string; byteSize: number; contentType: string; retentionUntilUtc?: string; protected: boolean; traceId?: string }> };
class DryRunRollback extends Error {}
const webRoot = path.resolve(import.meta.dirname, "..");
const manifestArgument = process.argv.find((value) => value.startsWith("--manifest="))?.slice("--manifest=".length);
if (!manifestArgument) throw new Error("LEGACY_IMPORT_MANIFEST_REQUIRED");
const manifestPath = path.resolve(webRoot, manifestArgument);
const manifestRoot = path.dirname(manifestPath);
const dryRun = process.argv.includes("--dry-run");
const refreshProbe = process.argv.includes("--refresh-probe");
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
if (manifest.version !== "legacy-d1-r2-export/v1") throw new Error("LEGACY_IMPORT_VERSION_UNSUPPORTED");
const configuration = await loadRuntimeConfiguration(webRoot);
const environment = environmentProjection(configuration);
const database = createPostgresClient({ url: environment.DATABASE_URL, max: 2 });
function digest(value: unknown) {
  const source = typeof value === "string" || value instanceof Uint8Array ? value : JSON.stringify(value);
  return createHash("sha256").update(source).digest("hex");
}
function identifier(value: string) { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error("LEGACY_IDENTIFIER_INVALID"); return `"${value}"`; }
function decode(value: PrivateValue, dataType: string) {
  if (value && typeof value === "object" && !Array.isArray(value) && "$bytesBase64" in value) return Buffer.from(String(value.$bytesBase64), "base64");
  if (dataType === "boolean") return value === true || value === 1 || value === "1";
  if (["smallint", "integer", "bigint", "numeric"].includes(dataType) && typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if ((dataType === "json" || dataType === "jsonb") && typeof value === "string") return JSON.parse(value);
  return value;
}
async function targetMetadata(client: PostgresClient) {
  const columns = await client<{ table_name: string; column_name: string; data_type: string }[]>`SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public'`;
  const byTable = new Map<string, Map<string, string>>();
  for (const column of columns) { const current = byTable.get(column.table_name) ?? new Map(); current.set(column.column_name, column.data_type); byTable.set(column.table_name, current); }
  const edges = await client<{ child: string; parent: string }[]>`SELECT child.relname AS child,parent.relname AS parent FROM pg_constraint constraint_row
    JOIN pg_class child ON child.oid=constraint_row.conrelid JOIN pg_class parent ON parent.oid=constraint_row.confrelid
    JOIN pg_namespace namespace_row ON namespace_row.oid=child.relnamespace WHERE constraint_row.contype='f' AND namespace_row.nspname='public'`;
  return { byTable, edges };
}
function insertionOrder(names: string[], edges: Array<{ child: string; parent: string }>) {
  const requested = new Set(names); const remaining = new Set(names); const result: string[] = [];
  while (remaining.size) {
    const ready = [...remaining].filter((name) => !edges.some((edge) => edge.child === name && edge.parent !== name && requested.has(edge.parent) && remaining.has(edge.parent))).sort();
    if (!ready.length) throw new Error("LEGACY_IMPORT_FOREIGN_KEY_CYCLE");
    for (const name of ready) { result.push(name); remaining.delete(name); }
  }
  return result;
}
async function ensureEmpty(client: PostgresClient, tables: string[]) {
  for (const table of tables) {
    const rows = await client.unsafe(`SELECT COUNT(*)::integer AS count FROM ${identifier(table)}`) as unknown as Array<{ count: number }>;
    if (Number(rows[0]?.count) !== 0) throw new Error("POSTGRES_IMPORT_REQUIRES_EMPTY_SCHEMA");
  }
}

try {
  await assertMigrationsCurrent(database, path.join(webRoot, "drizzle-postgres"));
  const metadata = await targetMetadata(database);
  const source = new Map(manifest.tables.filter((table) => metadata.byTable.has(table.name)).map((table) => [table.name, table]));
  const applicationTables = [...metadata.byTable.keys()].filter((name) => name !== "app_schema_migrations" && name !== "artifact_blobs");
  await ensureEmpty(database, [...applicationTables, "artifact_blobs"]);
  const importedCounts = new Map<string, number>();
  try {
    await withTransaction(database, async (transaction) => {
      for (const tableName of insertionOrder([...source.keys()], metadata.edges)) {
        const table = source.get(tableName)!; const targetColumns = metadata.byTable.get(tableName)!;
        for (const row of table.rows) {
          const columns = Object.keys(row).filter((name) => targetColumns.has(name));
          if (!columns.length) continue;
          const values = columns.map((name) => decode(row[name], targetColumns.get(name)!));
          const placeholders = columns.map((_, index) => `$${index + 1}`).join(",");
          await transaction.unsafe(`INSERT INTO ${identifier(tableName)} (${columns.map(identifier).join(",")}) VALUES (${placeholders})`, values as never[]);
          importedCounts.set(tableName, (importedCounts.get(tableName) ?? 0) + 1);
        }
      }
      for (const object of manifest.objects) {
        const bytes = await readFile(path.resolve(manifestRoot, object.blobFile));
        if (bytes.byteLength !== object.byteSize || digest(bytes) !== object.checksum) throw new Error("LEGACY_R2_BLOB_CHECKSUM_MISMATCH");
        const id = object.traceId ? `trace:${object.traceId}` : `legacy-r2:${object.sourceKeyHash.slice(0, 40)}`;
        await transaction`INSERT INTO artifact_blobs (id,scope,kind,checksum,mime_type,byte_size,retention_until_utc,protected,content,created_at_utc)
          VALUES (${id},${object.traceId ? "protected-llm-traces" : "legacy-r2-import"},${object.traceId ? "protected-llm-trace" : "legacy-r2-object"},
          ${object.checksum},${object.contentType},${object.byteSize},${object.retentionUntilUtc ?? null},${object.protected},${bytes},${new Date().toISOString()})`;
      }
      for (const [name, expected] of source) {
        const rows = await transaction.unsafe(`SELECT COUNT(*)::integer AS count FROM ${identifier(name)}`) as unknown as Array<{ count: number }>;
        if (Number(rows[0]?.count) !== expected.rows.length) throw new Error("LEGACY_IMPORT_COUNT_MISMATCH");
      }
      if (dryRun) throw new DryRunRollback("LEGACY_IMPORT_DRY_RUN_ROLLBACK");
    });
  } catch (error) { if (!(dryRun && error instanceof DryRunRollback)) throw error; }

  let oauthEnvelope = "absent";
  let refresh = "not-requested";
  let applicationRead = "not-run";
  if (!dryRun) {
    const oauth = new PostgresGoogleDriveOAuthRepository(database);
    const connection = await oauth.getConnection();
    if (connection?.refreshTokenEnvelope) {
      const keyring = parseGoogleOAuthKeyring(environment.GOOGLE_OAUTH_TOKEN_KEYRING_JSON);
      await decryptSecret(connection.refreshTokenEnvelope, connectionTokenAad({ id: connection.id, ownerSubject: connection.ownerSubject,
        scopes: connection.scopes, keyVersion: connection.refreshTokenEnvelope.keyVersion }), keyring);
      oauthEnvelope = "decrypt-ok";
      if (refreshProbe) { await createGoogleDriveOAuthRuntime({ database, environment }).tokenProvider.accessToken(); refresh = "ok"; }
    }
    await new PostgresProductRepository(database).dashboardSource(); applicationRead = "ok";
  }
  const evidence = { version: "legacy-postgres-import-evidence/v1", dryRun, sourceTables: source.size,
    sourceRows: [...source.values()].reduce((total, table) => total + table.rows.length, 0), importedObjects: manifest.objects.length,
    countsVerified: true, identityFingerprint: digest([...importedCounts.entries()].sort()), oauthEnvelope, refresh, applicationRead,
    containsRowValues: false, containsObjectNames: false, containsCredentials: false };
  await writeFile(path.join(manifestRoot, dryRun ? "import-dry-run-evidence.json" : "import-evidence.json"), JSON.stringify(evidence, null, 2), { encoding: "utf8", mode: 0o600 });
  console.log(JSON.stringify({ ready: true, ...evidence }));
} finally { await database.end({ timeout: 5 }); }
