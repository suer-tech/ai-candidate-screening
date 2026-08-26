import assert from "node:assert/strict";
import test from "node:test";
import { scenarios } from "./fixtures/vps-postgres-runtime/synthetic-matrix.mjs";
import { runVpsPostgresAcceptanceScenario, verifyVpsPostgresOracle } from "./helpers/vps-postgres-runtime-harness.mjs";

const cases = [
  ["production dependency graph and readiness contain PostgreSQL/Node only, with no Cloudflare path", scenarios.noCloudflare],
  ["PostgreSQL 16 clean and supported-upgrade migrations preserve identities and transactional invariants", scenarios.postgresSchema],
  ["concurrent claim/fencing, outbox reconcile, and immutable bounded blob contracts hold", scenarios.postgresDurability],
  ["Nitro builds and starts a Node target and authenticated routes work without Cloudflare bindings", scenarios.nodeRuntime],
  ["one runtime env and one credential allowlist reject inline, unknown, escaped, corporate Google, and Cloudflare settings", scenarios.configuration],
  ["private benchmark enforces consent, role/deny isolation, offline hard oracle, and unconditional cleanup using synthetic fixtures only", scenarios.privateBenchmark],
  ["dashboard and candidate list render the same server-derived 55 percent milestone in accessible progress bars", scenarios.progressUi],
  ["frozen HR-approved profile snapshot is the only profile basis and missing approval, checksum mismatch, or implicit regeneration fail closed before pipeline input reads and provider calls", scenarios.frozenProfileApproval],
  ["reference ABC/result and extracted anchors never create or mutate the profile and never reach provider payload, Drive snapshot, or blob store", scenarios.referenceDerivedProfile],
  ["exactly two owner-only generated PDFs are retained privately until review/deadline, then deletion is proven and incomplete cleanup is terminal RED", scenarios.privatePdfRetention],
  ["four canonical E2E run through the assembled Node web/worker and durable PostgreSQL on one build/config/fixture identity, not via in-memory/SQLite controller", scenarios.localCanonicalE2e],
];

for (const [title, fixture] of cases) {
  test(`${fixture.scenarioId}: ${title}`, async () => {
    const actual = await runVpsPostgresAcceptanceScenario(structuredClone(fixture));
    const failures = verifyVpsPostgresOracle(actual, fixture.oracle);
    assert.equal(failures.length, 0, `${failures.join("\n")}\nobserved=${JSON.stringify(actual)}`);
  });
}

