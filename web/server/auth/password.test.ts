import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeEmail, hashPassword, validatePassword, verifyPassword } from "./password.ts";

test("canonical email and versioned scrypt password envelope", async () => {
  assert.equal(canonicalizeEmail("  Alsu@Example.COM "), "alsu@example.com");
  assert.throws(() => validatePassword("short"), /AUTH_PASSWORD_TOO_SHORT/);
  const envelope = await hashPassword("correct horse battery staple");
  assert.match(envelope, /^scrypt\$v1\$/);
  assert.equal(envelope.includes("correct horse"), false);
  assert.equal(await verifyPassword("correct horse battery staple", envelope), true);
  assert.equal(await verifyPassword("incorrect password value", envelope), false);
});
