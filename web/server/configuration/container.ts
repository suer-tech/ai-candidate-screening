import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../db/schema.ts";
import { environmentProjection, loadRuntimeConfiguration, type RuntimeConfiguration } from "./runtime.ts";
import { createPostgresClient, type PostgresClient } from "../storage/postgres.ts";

export interface ServerContainer {
  configuration: RuntimeConfiguration;
  environment: Record<string, string>;
  sql: PostgresClient;
  db: PostgresJsDatabase<typeof schema>;
  close(): Promise<void>;
}

let containerPromise: Promise<ServerContainer> | undefined;

export function serverContainer(): Promise<ServerContainer> {
  containerPromise ??= (async () => {
    const configuration = await loadRuntimeConfiguration();
    const environment = environmentProjection(configuration);
    const sql = createPostgresClient({
      url: environment.DATABASE_URL,
      max: Number(configuration.values.DATABASE_MAX_CONNECTIONS || 10),
      idleTimeoutSeconds: Number(configuration.values.DATABASE_IDLE_TIMEOUT_SECONDS || 20),
      connectTimeoutSeconds: Number(configuration.values.DATABASE_CONNECT_TIMEOUT_SECONDS || 10),
    });
    return { configuration, environment, sql, db: drizzle(sql, { schema }), close: () => sql.end({ timeout: 5 }) };
  })();
  return containerPromise;
}

export function resetServerContainerForTests() {
  containerPromise = undefined;
}
