import assert from "node:assert/strict";
import test from "node:test";
import type { PostgresClient } from "../server/storage/postgres.ts";
import { PostgresVacancyMatrixRepository } from "../server/candidate-pipeline/matrix-postgres-repository.ts";

function strictPostgresTransport() {
  const captured: { leaseExpiresAt?: unknown; inserts: number } = { inserts: 0 };
  const transaction = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    if (query.includes("SELECT state,owner_id,fencing_token")) return [];
    if (query.includes("INSERT INTO vacancy_matrix_compilations")) {
      captured.inserts += 1;
      captured.leaseExpiresAt = values[2];
      if (typeof captured.leaseExpiresAt !== "string") {
        const error = new TypeError("ERR_INVALID_ARG_TYPE: PostgreSQL interpolation requires lease_expires_at_utc as an ISO string");
        Object.assign(error, { code: "ERR_INVALID_ARG_TYPE" });
        throw error;
      }
      assert.equal(captured.leaseExpiresAt, "2026-08-26T09:00:01.000Z");
      return [];
    }
    throw new Error(`UNEXPECTED_SQL:${query.replace(/\s+/g, " ").trim()}`);
  };
  Object.assign(transaction, {
    begin: async <T>(operation: (sql: typeof transaction) => Promise<T>) => operation(transaction),
  });
  return { sql: transaction as unknown as PostgresClient, captured };
}

test("MATRIX-POSTGRES-LEASE-RED-001: claimCompilation sends an ISO lease timestamp through PostgreSQL transport and creates the claim", async () => {
  const transport = strictPostgresTransport();
  const repository = new PostgresVacancyMatrixRepository(transport.sql);
  const claim = await repository.claimCompilation({
    profileVersion: "profile-lease-transport-v1",
    ownerId: "owner-lease-transport-v1",
    now: new Date("2026-08-26T09:00:00.000Z"),
    leaseMs: 1_000,
  });
  assert.equal(transport.captured.inserts, 1);
  assert.equal(typeof transport.captured.leaseExpiresAt, "string");
  assert.equal(transport.captured.leaseExpiresAt, "2026-08-26T09:00:01.000Z");
  assert.deepEqual(claim, { owner: true, waiting: false, fencingToken: 1, attempt: 1, recovered: false });
});
