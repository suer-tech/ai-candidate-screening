import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { serverContainer } from "../configuration/container.ts";
import { AuthService } from "./service.ts";

test("real PostgreSQL auth lifecycle stores only hashes and revokes sessions atomically", async () => {
  const container = await serverContainer();
  let clock = Date.now();
  const service = new AuthService(container.sql, "integration-fingerprint-key", () => clock);
  const marker = randomUUID();
  const email = `auth-test-${marker}@example.invalid`;
  let userId = "";
  try {
    const tables = await container.sql<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'auth_%'`;
    assert.deepEqual(new Set(tables.map((row) => row.table_name)), new Set(["auth_users", "auth_sessions", "auth_login_attempts", "auth_security_events"]));
    const concurrent = await Promise.allSettled([
      service.createUser({ email, displayName: "Synthetic HR", password: "temporary-password-123" }),
      service.createUser({ email, displayName: "Synthetic HR", password: "temporary-password-123" }),
    ]);
    assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);
    const created = concurrent.find((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof service.createUser>>> => result.status === "fulfilled")!.value;
    userId = created.id;
    const creationEvents = await container.sql<{ count: number }[]>`SELECT count(*)::integer AS count FROM auth_security_events WHERE target_id=${userId} AND event_type='USER_CREATED'`;
    assert.equal(creationEvents[0]?.count, 1);
    const login = await service.login({ email, password: "temporary-password-123", source: "integration", remember: false });
    assert.equal(login.scope, "PASSWORD_CHANGE_ONLY");
    const stored = await container.sql<{ token_hash: string }[]>`SELECT token_hash FROM auth_sessions WHERE user_id=${userId}`;
    assert.equal(stored.length, 1);
    assert.notEqual(stored[0].token_hash, login.token);
    const principal = await service.authenticate(login.token);
    assert.equal(principal?.id, userId);
    if (!principal) throw new Error("AUTH_INTEGRATION_PRINCIPAL_MISSING");
    const rotated = await service.changePassword(principal, undefined, "permanent-password-456", false);
    assert.equal(await service.authenticate(login.token), null);
    assert.equal((await service.authenticate(rotated.token))?.scope, "FULL");
    await service.setUserState(userId, "DISABLED");
    assert.equal(await service.authenticate(rotated.token), null);
    await service.setUserState(userId, "ACTIVE");
    const expiring = await service.login({ email, password: "permanent-password-456", source: "expiry", remember: false });
    clock += 43_201_000;
    assert.equal(await service.authenticate(expiring.token), null);
  } finally {
    if (userId) {
      await container.sql`DELETE FROM auth_security_events WHERE target_id=${userId} OR actor_id=${userId}`;
      await container.sql`DELETE FROM auth_users WHERE id=${userId}`;
    }
    await container.close();
  }
});
