import { stdin, stdout } from "node:process";
import { serverContainer } from "../server/configuration/container.ts";
import { authService } from "../server/auth/request-principal.ts";
import { canonicalizeEmail } from "../server/auth/password.ts";

type Action = "create" | "reset" | "enable" | "disable" | "revoke";

async function readSecret(label: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY || !stdin.setRawMode) throw new Error("AUTH_SECRET_REQUIRES_INTERACTIVE_TTY");
  stdout.write(label);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      stdin.setRawMode(false); stdin.pause(); stdin.removeListener("data", onData); stdout.write("\n");
      if (error) reject(error); else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\u0003") return finish(new Error("AUTH_OPERATOR_CANCELLED"));
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else if (character >= " ") value += character;
      }
    };
    stdin.on("data", onData);
  });
}

async function userIdForEmail(email: string) {
  const container = await serverContainer();
  const rows = await container.sql<{ id: string }[]>`SELECT id FROM auth_users WHERE canonical_email=${canonicalizeEmail(email)} LIMIT 1`;
  if (!rows[0]) throw new Error("AUTH_USER_NOT_FOUND");
  return rows[0].id;
}

async function main() {
  const action = process.argv[2] as Action | undefined;
  const email = process.argv[3]?.trim();
  if (!action || !["create", "reset", "enable", "disable", "revoke"].includes(action) || !email) {
    throw new Error("Usage: npm run auth:<action> -- user@company.ru [display name]");
  }
  const service = await authService();
  if (action === "create") {
    const displayName = process.argv.slice(4).join(" ").trim();
    if (!displayName) throw new Error("AUTH_DISPLAY_NAME_REQUIRED");
    const password = await readSecret("Временный пароль: ");
    const confirmation = await readSecret("Повторите пароль: ");
    if (password !== confirmation) throw new Error("AUTH_PASSWORD_CONFIRMATION_MISMATCH");
    await service.createUser({ email, displayName, password });
  } else {
    const userId = await userIdForEmail(email);
    if (action === "reset") {
      const password = await readSecret("Новый временный пароль: ");
      const confirmation = await readSecret("Повторите пароль: ");
      if (password !== confirmation) throw new Error("AUTH_PASSWORD_CONFIRMATION_MISMATCH");
      await service.resetPassword(userId, password);
    } else if (action === "enable") await service.setUserState(userId, "ACTIVE");
    else if (action === "disable") await service.setUserState(userId, "DISABLED");
    else await service.revokeSessions(userId);
  }
  stdout.write(`AUTH_OPERATOR_${action.toUpperCase()}_OK\n`);
  (await serverContainer()).close();
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "AUTH_OPERATOR_FAILED"}\n`); process.exitCode = 1; });
