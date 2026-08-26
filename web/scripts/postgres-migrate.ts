import { serverContainer } from "../server/configuration/container.ts";
import { migratePostgres } from "../server/storage/migrations.ts";

const container = await serverContainer();
try {
  const state = await migratePostgres(container.sql);
  process.stdout.write(JSON.stringify({ ready: true, applied: state.current, expected: state.expected }) + "\n");
} finally {
  await container.close();
}
