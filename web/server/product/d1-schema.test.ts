import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

async function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  const migration = await readFile(new URL("../../drizzle/0000_daily_skrulls.sql", import.meta.url), "utf8");
  for (const statement of migration.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
    database.exec(statement);
  }
  return database;
}

async function vacancyGenerationDatabase() {
  const database = await migratedDatabase();
  const migration = await readFile(new URL("../../drizzle/0002_unique_paibok.sql", import.meta.url), "utf8");
  database.exec("PRAGMA foreign_keys = ON");
  for (const statement of migration.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) database.exec(statement);
  return database;
}

test("D1 migration creates every product persistence boundary", async () => {
  const database = await migratedDatabase();
  try {
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
    assert.deepEqual(tables, ["audit_events", "candidate_tombstones", "candidates", "result_documents", "vacancies", "vacancy_operations"]);
  } finally {
    database.close();
  }
});

test("D1 migration enforces normalized vacancy and result identities", async () => {
  const database = await migratedDatabase();
  try {
    const operation = database.prepare("INSERT INTO vacancy_operations (operation_id, vacancy_id, normalized_title, input_json, state) VALUES (?, ?, ?, ?, 'provisioning')");
    operation.run("op-1", "vac-1", "бизнес ассистент", "{}" );
    assert.throws(() => operation.run("op-2", "vac-2", "бизнес ассистент", "{}"), /UNIQUE/);
    const result = database.prepare("INSERT INTO result_documents (candidate_id, type, version, descriptor_json) VALUES (?, ?, ?, ?)");
    result.run(1, "abc-test", 2, "{}");
    assert.throws(() => result.run(1, "abc-test", 2, "{}"), /UNIQUE/);
  } finally {
    database.close();
  }
});

test("vacancy generation migration persists bounded operations, attempts and safe audit", async () => {
  const database = await vacancyGenerationDatabase();
  try {
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
    for (const table of ["vacancy_generation_operations", "vacancy_generation_attempts", "vacancy_audit_events"]) assert.ok(tables.includes(table));
    database.prepare("INSERT INTO vacancy_generation_operations (operation_id, original_title, normalized_title, state, attempt_count, created_at, updated_at) VALUES (?, ?, ?, 'PENDING', 0, ?, ?)")
      .run("generation-1", " Бизнес  ассистент ", "бизнес ассистент", "2026-08-20T00:00:00Z", "2026-08-20T00:00:00Z");
    database.prepare("INSERT INTO vacancy_generation_attempts (operation_id, attempt_number, outcome, created_at) VALUES (?, 1, 'started', ?)")
      .run("generation-1", "2026-08-20T00:00:00Z");
    assert.throws(() => database.prepare("UPDATE vacancy_generation_operations SET attempt_count = 5 WHERE operation_id = ?").run("generation-1"), /CHECK/);
    database.prepare("DELETE FROM vacancy_generation_operations WHERE operation_id = ?").run("generation-1");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM vacancy_generation_attempts").get()!.count, 0);
  } finally { database.close(); }
});
