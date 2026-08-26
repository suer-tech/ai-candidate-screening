import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { PostgresClient } from "./postgres.ts";
import { withTransaction } from "./postgres.ts";

const MIGRATION_LOCK = 7_341_108_221;

export interface MigrationState { current: number; expected: number; pending: string[]; failed: string[] }

async function migrationFiles(root: string) {
  return (await readdir(root)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
}

function checksum(source: string) {
  return createHash("sha256").update(source).digest("hex");
}

async function ensureLedger(client: PostgresClient) {
  await client`CREATE TABLE IF NOT EXISTS app_schema_migrations (
    name text PRIMARY KEY,
    checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
    applied_at_utc timestamptz NOT NULL DEFAULT clock_timestamp()
  )`;
}

export async function inspectMigrationState(client: PostgresClient, root = path.resolve("drizzle-postgres")): Promise<MigrationState> {
  await ensureLedger(client);
  const files = await migrationFiles(root);
  const applied = await client<{ name: string; checksum: string }[]>`SELECT name, checksum FROM app_schema_migrations ORDER BY name`;
  const appliedByName = new Map(applied.map((row) => [row.name, row.checksum]));
  const pending: string[] = [];
  const failed: string[] = [];
  for (const name of files) {
    const source = await readFile(path.join(root, name), "utf8");
    const observed = appliedByName.get(name);
    if (!observed) pending.push(name);
    else if (observed !== checksum(source)) failed.push(name);
  }
  for (const name of appliedByName.keys()) if (!files.includes(name)) failed.push(name);
  return { current: applied.length, expected: files.length, pending, failed };
}

export async function migratePostgres(client: PostgresClient, root = path.resolve("drizzle-postgres")): Promise<MigrationState> {
  await client`SELECT pg_advisory_lock(${MIGRATION_LOCK})`;
  try {
    await ensureLedger(client);
    const before = await inspectMigrationState(client, root);
    if (before.failed.length) throw new Error("POSTGRES_MIGRATION_CHECKSUM_MISMATCH");
    for (const name of before.pending) {
      const source = await readFile(path.join(root, name), "utf8");
      const statements = source.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean);
      await withTransaction(client, async (transaction) => {
        for (const statement of statements) await transaction.unsafe(statement);
        await transaction`INSERT INTO app_schema_migrations (name, checksum) VALUES (${name}, ${checksum(source)})`;
      });
    }
    const after = await inspectMigrationState(client, root);
    if (after.pending.length || after.failed.length) throw new Error("POSTGRES_MIGRATIONS_NOT_CURRENT");
    return after;
  } finally {
    await client`SELECT pg_advisory_unlock(${MIGRATION_LOCK})`;
  }
}

export async function assertMigrationsCurrent(client: PostgresClient, root = path.resolve("drizzle-postgres")) {
  const state = await inspectMigrationState(client, root);
  if (state.pending.length || state.failed.length) throw new Error("POSTGRES_MIGRATIONS_NOT_CURRENT");
  return state;
}

