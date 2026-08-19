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
